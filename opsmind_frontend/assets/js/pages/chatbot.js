import GeminiService from '../../../services/geminiService.js';

let conversationHistory = [];

async function sendMessage(messageText) {
    if (!messageText.trim()) return;
    
    // Add user message to UI
    addMessageToUI('user', messageText);
    
    // Add user message to history
    conversationHistory.push({
        sender: 'user',
        text: messageText
    });
    
    // Show typing indicator
    showTypingIndicator();
    
    try {
        // IMPORTANT: Call the actual Gemini API, not quick response
        const response = await GeminiService.generateResponse(messageText, conversationHistory);
        
        // Hide typing indicator
        hideTypingIndicator();
        
        // Add AI response to UI
        addMessageToUI('bot', response);
        
        // Add AI response to history
        conversationHistory.push({
            sender: 'bot',
            text: response
        });
        
    } catch (error) {
        hideTypingIndicator();
        addMessageToUI('bot', `❌ Error: ${error.message}`);
        console.error('[Chatbot] Error:', error);
    }
}

function addMessageToUI(sender, text) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;
    
    const time = new Date().toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    if (sender === 'bot') {
        messageDiv.innerHTML = `
            <div class="message-avatar bot">
                <i class="bi bi-robot"></i>
            </div>
            <div>
                <div class="message-content">
                    <div>${formatMessage(text)}</div>
                    <div class="message-time">${time}</div>
                </div>
            </div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div>
                <div class="message-content">
                    <div>${formatMessage(text)}</div>
                    <div class="message-time">${time}</div>
                </div>
            </div>
            <div class="message-avatar user">
                <i class="bi bi-person"></i>
            </div>
        `;
    }
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function formatMessage(text) {
    // Convert markdown-style formatting to HTML
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
}

function showTypingIndicator() {
    const messagesContainer = document.getElementById('chatMessages');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-message bot';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = `
        <div class="message-avatar bot">
            <i class="bi bi-robot"></i>
        </div>
        <div>
            <div class="message-content">
                <div class="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        </div>
    `;
    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function hideTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) {
        indicator.remove();
    }
}

export function initChatbotPage() {
    console.log('[Chatbot] Initializing chatbot page...');
    
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendMessageBtn');
    const clearBtn = document.getElementById('clearChatBtn');
    const quickActions = document.querySelectorAll('.quick-action-btn');
    
    // Send message on button click
    sendBtn?.addEventListener('click', () => {
        const message = chatInput.value.trim();
        if (message) {
            sendMessage(message);
            chatInput.value = '';
        }
    });
    
    // Send message on Enter key
    chatInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const message = chatInput.value.trim();
            if (message) {
                sendMessage(message);
                chatInput.value = '';
            }
        }
    });
    
    // Quick action buttons
    quickActions.forEach(btn => {
        btn.addEventListener('click', () => {
            const message = btn.getAttribute('data-message');
            if (message) {
                chatInput.value = message;
                sendMessage(message);
                chatInput.value = '';
            }
        });
    });
    
    // Clear chat
    clearBtn?.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear the chat history?')) {
            conversationHistory = [];
            const messagesContainer = document.getElementById('chatMessages');
            messagesContainer.innerHTML = `
                <div class="chat-message bot">
                    <div class="message-avatar bot">
                        <i class="bi bi-robot"></i>
                    </div>
                    <div>
                        <div class="message-content">
                            <div>
                                👋 Hello! I'm your OpsMind AI Assistant. How can I help you today?
                            </div>
                            <div class="message-time">Just now</div>
                        </div>
                    </div>
                </div>
            `;
        }
    });
    
    document.body.classList.add('chatbot-page-initialized');
    console.log('[Chatbot] Page initialized successfully');
}