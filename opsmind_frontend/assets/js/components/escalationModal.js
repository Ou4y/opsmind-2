import UI from '/assets/js/ui.js';

export function openEscalationModal(options = {}) {
    const modalId = `escalationModal-${Date.now()}`;
    const title = options.title || 'Escalate Ticket';
    const confirmLabel = options.confirmLabel || 'Escalate';

    const modalHtml = `
        <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${UI.escapeHTML(title)}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label">Escalation reason</label>
                            <textarea class="form-control" rows="4" placeholder="Provide a brief reason"></textarea>
                        </div>
                        <div class="alert alert-danger d-none" role="alert"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-warning">
                            <span class="btn-text">${UI.escapeHTML(confirmLabel)}</span>
                            <span class="spinner-border spinner-border-sm ms-2 d-none" role="status" aria-hidden="true"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modalEl = document.getElementById(modalId);
    const modal = new bootstrap.Modal(modalEl);
    const reasonEl = modalEl.querySelector('textarea');
    const errorEl = modalEl.querySelector('.alert');
    const submitBtn = modalEl.querySelector('.btn.btn-warning');
    const submitText = submitBtn.querySelector('.btn-text');
    const submitSpinner = submitBtn.querySelector('.spinner-border');

    const setError = (message) => {
        if (!errorEl) return;
        if (!message) {
            errorEl.classList.add('d-none');
            errorEl.textContent = '';
            return;
        }
        errorEl.textContent = message;
        errorEl.classList.remove('d-none');
    };

    const setLoading = (loading) => {
        if (!submitBtn) return;
        submitBtn.disabled = loading;
        if (submitText) submitText.classList.toggle('d-none', loading);
        if (submitSpinner) submitSpinner.classList.toggle('d-none', !loading);
    };

    const handleSubmit = async () => {
        const reason = String(reasonEl?.value || '').trim();
        if (!reason) {
            setError('Reason is required.');
            return;
        }

        setError('');
        setLoading(true);

        try {
            if (typeof options.onSubmit === 'function') {
                await options.onSubmit(reason);
            }
            modal.hide();
        } catch (error) {
            setError(error?.message || 'Failed to escalate ticket.');
        } finally {
            setLoading(false);
        }
    };

    reasonEl?.addEventListener('input', () => setError(''));
    submitBtn?.addEventListener('click', handleSubmit);

    modalEl.addEventListener('hidden.bs.modal', () => {
        modalEl.remove();
    }, { once: true });

    modal.show();
    setTimeout(() => reasonEl?.focus(), 200);

    return { modalEl, setError, setLoading, close: () => modal.hide() };
}
