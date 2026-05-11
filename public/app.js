const STORAGE_KEY = 'chat-app-state-v1';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-latest';
const DEFAULT_BASE_URL = 'https://ai.hackclub.com/proxy/v1';

const elements = {
  sidebar: document.getElementById('sidebar'),
  messages: document.getElementById('messages'),
  conversationList: document.getElementById('conversationList'),
  composer: document.getElementById('composer'),
  promptInput: document.getElementById('promptInput'),
  fileInput: document.getElementById('fileInput'),
  attachmentPreview: document.getElementById('attachmentPreview'),
  modelSelect: document.getElementById('modelSelect'),
  webSearchToggle: document.getElementById('webSearchToggle'),
  newChatBtn: document.getElementById('newChatBtn'),
  toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsDialog: document.getElementById('settingsDialog'),
  settingsForm: document.getElementById('settingsForm'),
  baseUrlInput: document.getElementById('baseUrlInput'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  darkModeToggle: document.getElementById('darkModeToggle'),
  reasoningToggle: document.getElementById('reasoningToggle'),
};

const state = loadState();
let pendingAttachments = [];

applyTheme();
hydrateSettings();
ensureConversation();
renderConversationList();
renderMessages();
loadModels();

elements.newChatBtn.addEventListener('click', () => {
  const conversation = createConversation();
  state.activeConversationId = conversation.id;
  saveState();
  renderConversationList();
  renderMessages();
});

elements.toggleSidebarBtn.addEventListener('click', () => {
  elements.sidebar.classList.toggle('hidden');
});

elements.settingsBtn.addEventListener('click', () => {
  hydrateSettings();
  elements.settingsDialog.showModal();
});

elements.settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.settings.baseUrl = elements.baseUrlInput.value.trim() || DEFAULT_BASE_URL;
  state.settings.apiKey = elements.apiKeyInput.value.trim();
  state.settings.darkMode = elements.darkModeToggle.checked;
  state.settings.showReasoning = elements.reasoningToggle.checked;
  applyTheme();
  saveState();
  elements.settingsDialog.close();
  loadModels();
  renderMessages();
});

elements.fileInput.addEventListener('change', async () => {
  pendingAttachments = await Promise.all([...elements.fileInput.files].map(toAttachment));
  renderAttachmentPreview();
});

elements.composer.addEventListener('submit', async (event) => {
  event.preventDefault();

  const contentText = elements.promptInput.value.trim();
  if (!contentText && pendingAttachments.length === 0) {
    return;
  }

  const conversation = getActiveConversation();
  const userMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: buildUserContent(contentText, pendingAttachments),
    attachments: pendingAttachments,
  };

  conversation.messages.push(userMessage);
  const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', reasoning: '', images: [] };
  conversation.messages.push(assistantMessage);

  elements.promptInput.value = '';
  elements.fileInput.value = '';
  pendingAttachments = [];
  renderAttachmentPreview();
  updateConversationTitle(conversation, contentText || pendingAttachments[0]?.name || 'New chat');
  saveState();
  renderConversationList();
  renderMessages();

  try {
    await streamAssistantResponse(conversation, assistantMessage);
  } catch (error) {
    assistantMessage.content += `\n\n[Error] ${error.message}`;
  }

  saveState();
  renderMessages();
});

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      activeConversationId: parsed.activeConversationId || null,
      settings: {
        baseUrl: parsed.settings?.baseUrl || DEFAULT_BASE_URL,
        apiKey: parsed.settings?.apiKey || '',
        darkMode: parsed.settings?.darkMode ?? true,
        showReasoning: parsed.settings?.showReasoning ?? false,
      },
    };
  } catch {
    return {
      conversations: [],
      activeConversationId: null,
      settings: { baseUrl: DEFAULT_BASE_URL, apiKey: '', darkMode: true, showReasoning: false },
    };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function hydrateSettings() {
  elements.baseUrlInput.value = state.settings.baseUrl;
  elements.apiKeyInput.value = state.settings.apiKey;
  elements.darkModeToggle.checked = state.settings.darkMode;
  elements.reasoningToggle.checked = state.settings.showReasoning;
}

function applyTheme() {
  document.documentElement.classList.toggle('light', !state.settings.darkMode);
}

function createConversation() {
  const conversation = {
    id: crypto.randomUUID(),
    title: 'New chat',
    createdAt: Date.now(),
    messages: [],
  };
  state.conversations.unshift(conversation);
  return conversation;
}

function ensureConversation() {
  if (!state.conversations.length) {
    const conversation = createConversation();
    state.activeConversationId = conversation.id;
  }

  if (!state.conversations.some((chat) => chat.id === state.activeConversationId)) {
    state.activeConversationId = state.conversations[0].id;
  }
}

function getActiveConversation() {
  return state.conversations.find((chat) => chat.id === state.activeConversationId);
}

function renderConversationList() {
  elements.conversationList.innerHTML = '';

  state.conversations.forEach((chat) => {
    const button = document.createElement('button');
    button.className = `conversation-item ${chat.id === state.activeConversationId ? 'active' : ''}`;
    button.textContent = chat.title;
    button.addEventListener('click', () => {
      state.activeConversationId = chat.id;
      saveState();
      renderConversationList();
      renderMessages();
    });
    elements.conversationList.appendChild(button);
  });
}

function renderMessages() {
  const conversation = getActiveConversation();
  elements.messages.innerHTML = '';

  conversation.messages.forEach((message) => {
    const article = document.createElement('article');
    article.className = `message ${message.role}`;

    const text = document.createElement('div');
    text.textContent = typeof message.content === 'string'
      ? message.content
      : message.content?.find?.((part) => part?.type === 'text')?.text || '';
    article.appendChild(text);

    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    attachments.filter((file) => file.type.startsWith('image/')).forEach((image) => {
      const img = document.createElement('img');
      img.src = image.dataUrl;
      img.alt = image.name;
      article.appendChild(img);
    });

    if (Array.isArray(message.images)) {
      message.images.forEach((imageDataUrl) => {
        const img = document.createElement('img');
        img.src = imageDataUrl;
        img.alt = 'Generated image';
        article.appendChild(img);
      });
    }

    if (message.reasoning && state.settings.showReasoning) {
      const reasoning = document.createElement('details');
      reasoning.className = 'reasoning';
      reasoning.open = false;
      const summary = document.createElement('summary');
      summary.textContent = 'Reasoning';
      const pre = document.createElement('pre');
      pre.textContent = message.reasoning;
      reasoning.append(summary, pre);
      article.appendChild(reasoning);
    }

    elements.messages.appendChild(article);
  });

  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function renderAttachmentPreview() {
  elements.attachmentPreview.innerHTML = '';
  pendingAttachments.forEach((file) => {
    const chip = document.createElement('span');
    chip.className = 'attachment-chip';
    chip.textContent = `${file.name} (${Math.ceil(file.size / 1024)}KB)`;
    elements.attachmentPreview.appendChild(chip);
  });
}

function updateConversationTitle(conversation, text) {
  if (conversation.title === 'New chat' && text) {
    conversation.title = text.slice(0, 40);
  }
}

function buildUserContent(text, attachments) {
  if (!attachments.length) {
    return text;
  }

  const parts = [];
  if (text) {
    parts.push({ type: 'text', text });
  }

  attachments.forEach((file) => {
    if (file.type.startsWith('image/')) {
      parts.push({ type: 'image_url', image_url: { url: file.dataUrl } });
      return;
    }

    parts.push({
      type: 'file',
      file: {
        filename: file.name,
        file_data: file.dataUrl,
      },
    });
  });

  return parts;
}

async function toAttachment(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });

  return {
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    dataUrl,
  };
}

async function loadModels() {
  elements.modelSelect.innerHTML = '';

  try {
    const params = new URLSearchParams({ baseUrl: state.settings.baseUrl });
    const response = await fetch(`/api/models?${params}`);
    const data = await response.json();

    const models = Array.isArray(data.models) ? data.models : [];
    models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.id;
      elements.modelSelect.appendChild(option);
    });

    const defaultOption = data.defaultModel || DEFAULT_MODEL;
    if (![...elements.modelSelect.options].some((option) => option.value === defaultOption)) {
      const option = document.createElement('option');
      option.value = defaultOption;
      option.textContent = `${defaultOption} (default)`;
      elements.modelSelect.prepend(option);
    }

    elements.modelSelect.value = defaultOption;
  } catch {
    const option = document.createElement('option');
    option.value = DEFAULT_MODEL;
    option.textContent = `${DEFAULT_MODEL} (fallback)`;
    elements.modelSelect.appendChild(option);
    elements.modelSelect.value = DEFAULT_MODEL;
  }
}

async function streamAssistantResponse(conversation, assistantMessage) {
  const payload = {
    baseUrl: state.settings.baseUrl,
    apiKey: state.settings.apiKey,
    model: elements.modelSelect.value || DEFAULT_MODEL,
    enableWebSearch: elements.webSearchToggle.checked,
    messages: conversation.messages
      .filter((message) => message.id !== assistantMessage.id)
      .map(({ role, content }) => ({ role, content })),
  };

  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to stream response');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      const dataLine = event
        .split('\n')
        .find((line) => line.startsWith('data: '));

      if (!dataLine) {
        continue;
      }

      const payloadText = dataLine.slice(6);
      if (payloadText === '[DONE]') {
        return;
      }

      try {
        const payloadJson = JSON.parse(payloadText);
        const delta = payloadJson?.choices?.[0]?.delta;

        if (typeof delta?.content === 'string') {
          assistantMessage.content += delta.content;
        }

        if (typeof delta?.reasoning === 'string') {
          assistantMessage.reasoning += delta.reasoning;
        }

        const imageUrl = delta?.images?.[0]?.image_url?.url || payloadJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (imageUrl) {
          assistantMessage.images.push(imageUrl);
        }
      } catch {
        // Ignore malformed SSE chunks.
      }

      renderMessages();
    }
  }
}
