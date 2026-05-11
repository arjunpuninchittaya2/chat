const STORAGE_KEY = 'chat-app-state-v1';
const DEFAULT_MODEL = '~anthropic/claude-sonnet-latest';
const DEFAULT_BASE_URL = 'https://ai.hackclub.com/proxy/v1';
const MAX_CONVERSATION_TITLE_LENGTH = 40;
const BYTES_PER_KB = 1024;

const elements = {
  sidebar: document.getElementById('sidebar'),
  messages: document.getElementById('messages'),
  conversationList: document.getElementById('conversationList'),
  composer: document.getElementById('composer'),
  promptInput: document.getElementById('promptInput'),
  fileInput: document.getElementById('fileInput'),
  attachmentPreview: document.getElementById('attachmentPreview'),
  modelSelect: document.getElementById('modelSelect'),
  newChatBtn: document.getElementById('newChatBtn'),
  toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsDialog: document.getElementById('settingsDialog'),
  settingsForm: document.getElementById('settingsForm'),
  baseUrlInput: document.getElementById('baseUrlInput'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  searchApiKeyInput: document.getElementById('searchApiKeyInput'),
  webSearchToggle: document.getElementById('webSearchToggle'),
  darkModeToggle: document.getElementById('darkModeToggle'),
  reasoningToggle: document.getElementById('reasoningToggle'),
  scrollBottomBtn: document.getElementById('scrollBottomBtn'),
  draftPreview: document.getElementById('draftPreview'),
  draftPreviewText: document.getElementById('draftPreviewText'),
};

const state = loadState();
let pendingAttachments = [];

hydrateSettings();
ensureConversation();
renderConversationList();
renderMessages();
loadModels();
autoResizeInput();
updateDraftPreview();

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
  state.settings.searchApiKey = elements.searchApiKeyInput.value.trim();
  state.settings.enableWebSearch = elements.webSearchToggle.checked;
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

elements.modelSelect.addEventListener('change', () => {
  state.settings.selectedModel = elements.modelSelect.value || DEFAULT_MODEL;
  saveState();
});

elements.promptInput.addEventListener('input', () => {
  autoResizeInput();
  updateDraftPreview();
});

elements.messages.addEventListener('scroll', updateScrollButton);

elements.scrollBottomBtn.addEventListener('click', () => {
  elements.messages.scrollTo({ top: elements.messages.scrollHeight, behavior: 'smooth' });
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
  const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', reasoning: '', images: [], sources: [] };
  conversation.messages.push(assistantMessage);

  elements.promptInput.value = '';
  elements.fileInput.value = '';
  pendingAttachments = [];
  renderAttachmentPreview();
  autoResizeInput();
  updateDraftPreview();

  updateConversationTitle(conversation, contentText || userMessage.attachments[0]?.name || 'New chat');
  saveState();
  renderConversationList();
  renderMessages();

  try {
    if (state.settings.enableWebSearch) {
      assistantMessage.sources = await fetchWebSources(contentText || getMessageText(userMessage));
    }
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
        searchApiKey: parsed.settings?.searchApiKey || '',
        selectedModel: parsed.settings?.selectedModel || DEFAULT_MODEL,
        enableWebSearch: parsed.settings?.enableWebSearch ?? true,
        darkMode: parsed.settings?.darkMode ?? true,
        showReasoning: parsed.settings?.showReasoning ?? false,
      },
    };
  } catch {
    return {
      conversations: [],
      activeConversationId: null,
      settings: {
        baseUrl: DEFAULT_BASE_URL,
        apiKey: '',
        searchApiKey: '',
        selectedModel: DEFAULT_MODEL,
        enableWebSearch: true,
        darkMode: true,
        showReasoning: false,
      },
    };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function hydrateSettings() {
  elements.baseUrlInput.value = state.settings.baseUrl;
  elements.apiKeyInput.value = state.settings.apiKey;
  elements.searchApiKeyInput.value = state.settings.searchApiKey;
  elements.webSearchToggle.checked = state.settings.enableWebSearch;
  elements.darkModeToggle.checked = state.settings.darkMode;
  elements.reasoningToggle.checked = state.settings.showReasoning;
  applyTheme();
}

function applyTheme() {
  document.documentElement.classList.toggle('light', !state.settings.darkMode);
}

function autoResizeInput() {
  elements.promptInput.style.height = '42px';
  elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 180)}px`;
}

function updateDraftPreview() {
  const value = elements.promptInput.value.trim();
  if (!value) {
    elements.draftPreview.hidden = true;
    elements.draftPreviewText.textContent = '';
    return;
  }

  elements.draftPreview.hidden = false;
  elements.draftPreviewText.textContent = value;
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
    saveState();
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
    const text = document.createElement('span');
    text.textContent = chat.title;
    button.appendChild(text);
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

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';

    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = getMessageText(message);
    messageContent.appendChild(text);

    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    attachments.filter((file) => file.type.startsWith('image/')).forEach((image) => {
      const safeImageUrl = sanitizeImageUrl(image.dataUrl);
      if (!safeImageUrl) return;
      const img = document.createElement('img');
      img.src = safeImageUrl;
      img.alt = image.name;
      messageContent.appendChild(img);
    });

    if (Array.isArray(message.images)) {
      message.images.forEach((imageDataUrl) => {
        const safeImageUrl = sanitizeImageUrl(imageDataUrl);
        if (!safeImageUrl) return;
        const img = document.createElement('img');
        img.src = safeImageUrl;
        img.alt = 'Generated image';
        messageContent.appendChild(img);
      });
    }

    if (message.reasoning && state.settings.showReasoning) {
      const reasoning = document.createElement('details');
      reasoning.className = 'reasoning';
      const summary = document.createElement('summary');
      summary.textContent = 'Reasoning';
      const pre = document.createElement('pre');
      pre.textContent = message.reasoning;
      reasoning.append(summary, pre);
      messageContent.appendChild(reasoning);
    }

    if (message.role === 'assistant' && (message.content || (message.images && message.images.length))) {
      messageContent.appendChild(buildAssistantActions(message));
    }

    article.appendChild(messageContent);
    elements.messages.appendChild(article);
  });

  elements.messages.scrollTop = elements.messages.scrollHeight;
  updateScrollButton();
}

function buildAssistantActions(message) {
  const row = document.createElement('div');
  row.className = 'assistant-actions';

  const copy = document.createElement('button');
  copy.textContent = '⧉';
  copy.title = 'Copy';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(getMessageText(message));
  });

  const like = document.createElement('button');
  like.textContent = '👍';
  like.title = 'Like';
  like.addEventListener('click', () => {
    like.classList.toggle('active');
    dislike.classList.remove('active');
  });

  const dislike = document.createElement('button');
  dislike.textContent = '👎';
  dislike.title = 'Dislike';
  dislike.addEventListener('click', () => {
    dislike.classList.toggle('active');
    like.classList.remove('active');
  });

  const regenerate = document.createElement('button');
  regenerate.textContent = '↻';
  regenerate.title = 'Regenerate';
  regenerate.addEventListener('click', () => regenerateMessage(message.id));

  const sources = document.createElement('button');
  sources.textContent = 'Sources';
  sources.title = 'Sources';
  sources.className = 'sources-pill';
  if (!Array.isArray(message.sources) || message.sources.length === 0) {
    sources.disabled = true;
  }
  sources.addEventListener('click', () => {
    const lines = (Array.isArray(message.sources) ? message.sources : [])
      .map((item, index) => `${index + 1}. ${item.title || 'Untitled'}\n${item.url || ''}`)
      .join('\n\n');
    alert(lines || 'No sources available for this response.');
  });

  row.append(copy, like, dislike, regenerate, sources);
  return row;
}

async function regenerateMessage(messageId) {
  const conversation = getActiveConversation();
  const index = conversation.messages.findIndex((item) => item.id === messageId);
  if (index < 1 || conversation.messages[index].role !== 'assistant') {
    return;
  }

  conversation.messages = conversation.messages.slice(0, index);
  const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', reasoning: '', images: [], sources: [] };
  conversation.messages.push(assistantMessage);
  renderMessages();

  try {
    const previousUser = [...conversation.messages].reverse().find((msg) => msg.role === 'user');
    if (state.settings.enableWebSearch && previousUser) {
      assistantMessage.sources = await fetchWebSources(getMessageText(previousUser));
    }
    await streamAssistantResponse(conversation, assistantMessage);
  } catch (error) {
    assistantMessage.content += `\n\n[Error] ${error.message}`;
  }

  saveState();
  renderMessages();
}

function updateScrollButton() {
  const threshold = 120;
  const hidden = elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight < threshold;
  elements.scrollBottomBtn.classList.toggle('visible', !hidden);
}

function getMessageText(message) {
  return typeof message.content === 'string'
    ? message.content
    : message.content?.find?.((part) => part?.type === 'text')?.text || '';
}

function renderAttachmentPreview() {
  elements.attachmentPreview.innerHTML = '';
  pendingAttachments.forEach((file, index) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = `${file.name} (${Math.ceil(file.size / BYTES_PER_KB)}KB)`;
    chip.appendChild(nameSpan);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      pendingAttachments.splice(index, 1);
      renderAttachmentPreview();
    });
    chip.appendChild(closeBtn);

    elements.attachmentPreview.appendChild(chip);
  });
}

function updateConversationTitle(conversation, text) {
  if (conversation.title === 'New chat' && text) {
    conversation.title = text.slice(0, MAX_CONVERSATION_TITLE_LENGTH);
  }
}

function sanitizeImageUrl(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }

  if (/^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,/i.test(value)) {
    return value;
  }

  try {
    const parsed = new URL(value);
    const isAllowedProtocol = parsed.protocol === 'https:';
    const looksLikeImage = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(parsed.pathname);
    if (isAllowedProtocol && looksLikeImage) {
      return value;
    }
  } catch {
    return null;
  }

  return null;
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
      option.textContent = defaultOption;
      elements.modelSelect.prepend(option);
    }

    const selectedModel = state.settings.selectedModel || defaultOption;
    elements.modelSelect.value = [...elements.modelSelect.options].some((option) => option.value === selectedModel)
      ? selectedModel
      : defaultOption;
  } catch {
    const option = document.createElement('option');
    option.value = DEFAULT_MODEL;
    option.textContent = DEFAULT_MODEL;
    elements.modelSelect.appendChild(option);
    elements.modelSelect.value = DEFAULT_MODEL;
  }

  state.settings.selectedModel = elements.modelSelect.value || DEFAULT_MODEL;
  saveState();
}

async function streamAssistantResponse(conversation, assistantMessage) {
  const payload = {
    baseUrl: state.settings.baseUrl,
    apiKey: state.settings.apiKey,
    searchApiKey: state.settings.searchApiKey,
    model: elements.modelSelect.value || DEFAULT_MODEL,
    enableWebSearch: state.settings.enableWebSearch,
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

async function fetchWebSources(query) {
  const apiKey = state.settings.searchApiKey || state.settings.apiKey;
  if (!apiKey || !query?.trim()) {
    return [];
  }

  const response = await fetch('/api/web-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, query: query.trim() }),
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.results) ? data.results : [];
}
