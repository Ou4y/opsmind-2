export function createSmoothTextStreamer(targetElement, options = {}) {
    if (!targetElement) {
        throw new Error('Target element is required for smooth text streaming.');
    }

    const settings = {
        charsPerFrame: Math.max(1, Number(options.charsPerFrame || 5)),
        scrollContainer: options.scrollContainer || targetElement,
        statusElement: options.statusElement || null
    };

    const textNode = document.createTextNode('');
    const cursorNode = document.createElement('span');
    cursorNode.className = 'ai-stream-cursor';
    cursorNode.textContent = ' ';

    let displayText = '';
    let pendingText = '';
    let isFinished = false;
    let frameId = null;

    targetElement.innerHTML = '';
    targetElement.appendChild(textNode);
    targetElement.appendChild(cursorNode);
    targetElement.classList.add('ai-stream-output');

    function autoScroll() {
        const container = settings.scrollContainer;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
    }

    function tick() {
        if (pendingText.length > 0) {
            const nextChunk = pendingText.slice(0, settings.charsPerFrame);
            pendingText = pendingText.slice(settings.charsPerFrame);
            displayText += nextChunk;
            textNode.data = displayText;
            autoScroll();
            frameId = requestAnimationFrame(tick);
            return;
        }

        if (isFinished) {
            frameId = null;
            cursorNode.classList.add('d-none');
            return;
        }

        frameId = null;
    }

    function ensureTicking() {
        if (frameId !== null) return;
        frameId = requestAnimationFrame(tick);
    }

    function setStatus(message, isError = false) {
        if (!settings.statusElement) return;
        settings.statusElement.textContent = message || '';
        settings.statusElement.classList.toggle('text-danger', Boolean(isError));
        settings.statusElement.classList.toggle('text-muted', !isError);
    }

    return {
        push(chunk) {
            const text = String(chunk || '');
            if (!text) return;
            pendingText += text;
            cursorNode.classList.remove('d-none');
            isFinished = false;
            ensureTicking();
        },

        finish() {
            isFinished = true;
            setStatus('');
            if (pendingText.length > 0) {
                ensureTicking();
                return;
            }
            cursorNode.classList.add('d-none');
        },

        error(message) {
            isFinished = true;
            pendingText = '';
            if (frameId !== null) {
                cancelAnimationFrame(frameId);
                frameId = null;
            }
            cursorNode.classList.add('d-none');
            setStatus(message, true);
        },

        reset(message = '') {
            if (frameId !== null) {
                cancelAnimationFrame(frameId);
                frameId = null;
            }
            displayText = '';
            pendingText = '';
            isFinished = false;
            textNode.data = '';
            cursorNode.classList.remove('d-none');
            setStatus(message, false);
        },

        getText() {
            return `${displayText}${pendingText}`;
        }
    };
}

export default createSmoothTextStreamer;
