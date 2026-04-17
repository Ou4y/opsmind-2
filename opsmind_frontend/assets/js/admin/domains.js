document.addEventListener('DOMContentLoaded', () => {
    // Requires admin privilege
    requireRole(['ADMIN']);

    const AUTH_API_BASE = (
        window.APP_CONFIG?.services?.auth ||
        window.OPSMIND_API_URL ||
        'http://localhost:3002'
    ).replace(/\/$/, '');
    
    // UI Elements
    const elements = {
        loading: document.getElementById('domainsLoading'),
        empty: document.getElementById('domainsEmpty'),
        error: document.getElementById('domainsError'),
        tableContainer: document.getElementById('domainsTableContainer'),
        tableBody: document.getElementById('domainsTableBody'),
        addForm: document.getElementById('addDomainForm'),
        addInput: document.getElementById('domainInput'),
        addError: document.getElementById('addDomainError'),
        saveBtn: document.getElementById('saveDomainBtn'),
        deleteName: document.getElementById('deleteDomainName'),
        confirmDeleteBtn: document.getElementById('confirmDeleteBtn')
    };

    // Modals
    const addModal = new bootstrap.Modal(document.getElementById('addDomainModal'));
    const deleteModal = new bootstrap.Modal(document.getElementById('deleteDomainModal'));
    
    let domainToDelete = null;

    // Load Domains
    async function loadDomains() {
        showLoading(true);
        showError(false);
        
        try {
            const token = localStorage.getItem('opsmind_token');
            const response = await fetch(`${AUTH_API_BASE}/admin/domains`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                let message = 'Failed to fetch domains';
                try {
                    const errorData = await response.json();
                    message = errorData?.message || message;
                } catch {
                    // Ignore JSON parse errors and keep the default message.
                }
                throw new Error(message);
            }

            const data = await response.json();
            const domains = Array.isArray(data?.data)
                ? data.data
                : Array.isArray(data?.data?.domains)
                    ? data.data.domains
                    : [];

            if (data?.success && domains.length >= 0) {
                renderDomains(domains);
            } else {
                renderDomains([]);
            }
        } catch (error) {
            console.error('Error loading domains:', error);
            showError(true, error?.message || 'Failed to load domains. Please try again later.');
            showTable(false);
            showEmpty(false);
        } finally {
            showLoading(false);
        }
    }

    // Render Domains
    function renderDomains(domains) {
        if (!domains || domains.length === 0) {
            showEmpty(true);
            showTable(false);
            return;
        }

        elements.tableBody.innerHTML = domains.map(domain => `
            <tr>
                <td><strong>${domain.domain}</strong></td>
                <td>
                    <span class="badge ${domain.is_active ? 'bg-success' : 'bg-secondary'}">
                        ${domain.is_active ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>${new Date(domain.created_at).toLocaleDateString()}</td>
                <td class="text-end">
                    <button
                        class="btn btn-sm btn-outline-danger delete-btn"
                        data-domain-id="${domain.id}"
                        data-domain-name="${domain.domain}"
                    >
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');

        // Attach event listeners to delete buttons
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const button = e.target.closest('.delete-btn');
                domainToDelete = {
                    id: button.getAttribute('data-domain-id'),
                    name: button.getAttribute('data-domain-name')
                };
                elements.deleteName.textContent = domainToDelete.name;
                deleteModal.show();
            });
        });

        showEmpty(false);
        showTable(true);
    }

    // Add Domain
    elements.addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const domain = elements.addInput.value.trim().toLowerCase();
        if (!domain) return;

        elements.saveBtn.disabled = true;
        elements.addError.classList.add('d-none');
        
        try {
            const token = localStorage.getItem('opsmind_token');
            const response = await fetch(`${AUTH_API_BASE}/admin/domains`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ domain })
            });

            const data = await response.json();
            
            if (response.ok) {
                addModal.hide();
                elements.addInput.value = '';
                loadDomains();
                
                // Show success notification if you have a toast system
                if (window.showToast) {
                    window.showToast('Success', 'Domain added successfully', 'success');
                }
            } else {
                elements.addError.textContent = data.message || 'Failed to add domain';
                elements.addError.classList.remove('d-none');
            }
        } catch (error) {
            console.error('Add domain error:', error);
            elements.addError.textContent = 'Network or server error occurred';
            elements.addError.classList.remove('d-none');
        } finally {
            elements.saveBtn.disabled = false;
        }
    });

    // Delete Domain
    elements.confirmDeleteBtn.addEventListener('click', async () => {
        if (!domainToDelete?.id) return;
        
        elements.confirmDeleteBtn.disabled = true;
        
        try {
            const token = localStorage.getItem('opsmind_token');
            const response = await fetch(`${AUTH_API_BASE}/admin/domains/${encodeURIComponent(domainToDelete.id)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                deleteModal.hide();
                domainToDelete = null;
                loadDomains();
                
                if (window.showToast) {
                    window.showToast('Success', 'Domain deleted successfully', 'success');
                }
            } else {
                const data = await response.json();
                console.error('Delete failed:', data.message);
                alert(data.message || 'Failed to delete domain');
            }
        } catch (error) {
            console.error('Delete domain error:', error);
            alert('A network or server error occurred');
        } finally {
            elements.confirmDeleteBtn.disabled = false;
        }
    });

    // UI Helpers
    function showLoading(show) {
        if (show) elements.loading.classList.remove('d-none');
        else elements.loading.classList.add('d-none');
    }

    function showEmpty(show) {
        if (show) elements.empty.classList.remove('d-none');
        else elements.empty.classList.add('d-none');
    }

    function showTable(show) {
        if (show) elements.tableContainer.classList.remove('d-none');
        else elements.tableContainer.classList.add('d-none');
    }

    function showError(show, message = 'Failed to load domains. Please try again later.') {
        if (show) {
            elements.error.textContent = message;
            elements.error.classList.remove('d-none');
        } else {
            elements.error.classList.add('d-none');
        }
    }

    // Role verification function (stub for context)
    // Role verification function
    function requireRole(roles) {
    // Use the same source of truth as the whole app
    if (!window.AuthService && typeof AuthService === 'undefined') {
        console.warn('AuthService not available; skipping role check');
        return;
    }

    const svc = (typeof AuthService !== 'undefined') ? AuthService : window.AuthService;

    if (!svc.isAuthenticated()) {
        window.location.href = '/index.html';
        return;
    }

    const user = svc.getUser?.() || svc.getCurrentUser?.();
    const role = user?.role?.toUpperCase();

    if (!role || !roles.map(r => r.toUpperCase()).includes(role)) {
        console.warn('Unauthorized role access attempt:', role);
        // keep user on a safe page for their role
        window.location.href = role === 'ADMIN' ? '/pages/admin/domains.html' : '/pages/dashboard.html';
    }
}

    // Initial load
    loadDomains();
});