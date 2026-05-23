import UI from '/assets/js/ui.js';
import AuthService from '/services/authService.js';
import AgenticAiService from '/services/agenticAiService.js';

const SUPPORT_ROLE_SET = new Set([
    'ADMIN',
    'SUPERVISOR',
    'TECHNICIAN',
    'JUNIOR_TECHNICIAN',
    'SENIOR_TECHNICIAN',
    'L1_TECHNICIAN',
    'L2_TECHNICIAN',
    'L3_TECHNICIAN',
    'L4_TECHNICIAN',
    'L1',
    'L2',
    'L3',
    'L4',
    'JUNIOR',
    'SENIOR',
    'SYSTEM_ADMIN',
    'ADMINISTRATOR',
    'HEAD_OF_IT',
    'IT_ADMIN',
    'BUILDING_MANAGER',
    'SENIOR_BUILDING_MANAGER'
]);

const state = {
    devices: [],
    isLoading: false,
    hasAccess: false,
    filters: {
        status: '',
        osType: '',
        userId: ''
    }
};

function normalizeRole(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_');
}

function resolveRoleSet() {
    const user = AuthService.getCurrentUser?.() || AuthService.getUser?.() || {};
    const context = AuthService.resolveUserDashboardContext?.(user) || {};
    const roleSet = new Set();

    const primaryRole = normalizeRole(user.role);
    if (primaryRole) roleSet.add(primaryRole);

    if (Array.isArray(user.roles)) {
        user.roles.forEach((role) => {
            const normalized = normalizeRole(role);
            if (normalized) roleSet.add(normalized);
        });
    }

    const levelCandidates = [
        user.technicianLevel,
        user.technician_level,
        user.level,
        user.supportLevel,
        user.support_level,
        context.technicianLevel
    ];

    levelCandidates.forEach((value) => {
        const normalized = normalizeRole(value);
        if (normalized) roleSet.add(normalized);
    });

    if (context.roleCategory === 'ADMIN') {
        roleSet.add('ADMIN');
    }

    if (context.roleCategory === 'TECHNICIAN') {
        roleSet.add('TECHNICIAN');
    }

    return roleSet;
}

function hasSupportAccess() {
    const roles = resolveRoleSet();
    return Array.from(roles).some((role) => SUPPORT_ROLE_SET.has(role));
}

function waitForApp() {
    return new Promise((resolve) => {
        if (document.querySelector('.navbar-main')) {
            resolve();
        } else {
            document.addEventListener('app:ready', resolve, { once: true });
        }
    });
}

function renderState({ loading = false, unauthorized = false, error = false, empty = false, table = false } = {}) {
    UI.toggle('#registeredDevicesLoading', loading);
    UI.toggle('#registeredDevicesUnauthorized', unauthorized);
    UI.toggle('#registeredDevicesError', error);
    UI.toggle('#registeredDevicesEmpty', empty);
    UI.toggle('#registeredDevicesTableWrap', table);
}

function setCountBadge(count) {
    const badge = document.getElementById('registeredDevicesCountBadge');
    if (!badge) return;
    badge.textContent = `${count} device${count === 1 ? '' : 's'}`;
}

function formatDateTime(value) {
    if (!value) return '--';
    return UI.formatDateTime(value);
}

function renderStatusBadge(status) {
    const normalized = normalizeRole(status) || 'OFFLINE';
    const className = normalized === 'ONLINE'
        ? 'bg-success'
        : normalized === 'DISABLED'
            ? 'bg-danger'
            : 'bg-secondary';

    return `<span class="badge ${className}">${UI.escapeHTML(normalized)}</span>`;
}

function renderOsBadge(osType) {
    const normalized = normalizeRole(osType) || 'UNKNOWN';
    const className = normalized === 'MACOS'
        ? 'bg-info'
        : normalized === 'WINDOWS'
            ? 'bg-primary'
            : normalized === 'LINUX'
                ? 'bg-dark'
                : 'bg-secondary';

    return `<span class="badge ${className}">${UI.escapeHTML(normalized)}</span>`;
}

function renderDevicesTable() {
    const tableBody = document.getElementById('registeredDevicesTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = state.devices.map((device) => {
        const isEnabled = device.is_agent_enabled === true;
        const actionButton = isEnabled
            ? `
                <button class="btn btn-outline-danger btn-sm" data-action="disable" data-device-id="${UI.escapeHTML(device.id)}">
                    Disable
                </button>
            `
            : `
                <button class="btn btn-success btn-sm" data-action="enable" data-device-id="${UI.escapeHTML(device.id)}">
                    Enable
                </button>
            `;

        return `
            <tr>
                <td>${UI.escapeHTML(device.device_name || '--')}</td>
                <td class="small text-muted">${UI.escapeHTML(device.id || '--')}</td>
                <td class="small text-muted">${UI.escapeHTML(device.user_id || '--')}</td>
                <td>${renderOsBadge(device.os_type)}</td>
                <td>${renderStatusBadge(device.agent_status)}</td>
                <td>${UI.escapeHTML(device.agent_version || '--')}</td>
                <td>${UI.escapeHTML(formatDateTime(device.last_seen_at))}</td>
                <td>${UI.escapeHTML(formatDateTime(device.registered_at))}</td>
                <td>${isEnabled ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-danger">No</span>'}</td>
                <td class="text-end">${actionButton}</td>
            </tr>
        `;
    }).join('');
}

function collectFilters() {
    return {
        status: String(document.getElementById('registeredDeviceStatusFilter')?.value || '').trim(),
        osType: String(document.getElementById('registeredDeviceOsFilter')?.value || '').trim(),
        userId: String(document.getElementById('registeredDeviceUserIdFilter')?.value || '').trim()
    };
}

async function loadDevices() {
    if (state.isLoading) return;
    state.isLoading = true;
    renderState({ loading: true });

    try {
        const devices = await AgenticAiService.listAllEndpointDevices(state.filters);
        state.devices = Array.isArray(devices) ? devices : [];
        setCountBadge(state.devices.length);

        if (state.devices.length === 0) {
            renderState({ empty: true });
            return;
        }

        renderDevicesTable();
        renderState({ table: true });
    } catch (error) {
        console.error('[EndpointDevices] Failed to load devices:', error);
        const errorMessageEl = document.getElementById('registeredDevicesErrorMessage');
        if (errorMessageEl) {
            errorMessageEl.textContent = error?.message || 'Could not load registered devices.';
        }
        renderState({ error: true });
    } finally {
        state.isLoading = false;
    }
}

async function handleDeviceAction(event) {
    const actionButton = event.target.closest('[data-action][data-device-id]');
    if (!actionButton) return;

    const action = String(actionButton.dataset.action || '').trim();
    const deviceId = String(actionButton.dataset.deviceId || '').trim();
    if (!action || !deviceId) return;

    UI.setButtonLoading(actionButton, true);

    try {
        if (action === 'enable') {
            await AgenticAiService.enableEndpointDevice(deviceId);
            UI.success('Endpoint device enabled.');
        } else if (action === 'disable') {
            await AgenticAiService.disableEndpointDevice(deviceId);
            UI.success('Endpoint device disabled.');
        }
        await loadDevices();
    } catch (error) {
        UI.error(error?.message || 'Device update failed.');
    } finally {
        UI.setButtonLoading(actionButton, false);
    }
}

function setupEventListeners() {
    document.getElementById('refreshRegisteredDevicesBtn')?.addEventListener('click', () => {
        state.filters = collectFilters();
        void loadDevices();
    });

    document.getElementById('registeredDeviceStatusFilter')?.addEventListener('change', (event) => {
        state.filters.status = String(event.target?.value || '').trim();
        void loadDevices();
    });

    document.getElementById('registeredDeviceOsFilter')?.addEventListener('change', (event) => {
        state.filters.osType = String(event.target?.value || '').trim();
        void loadDevices();
    });

    document.getElementById('registeredDeviceUserIdFilter')?.addEventListener('input', UI.debounce((event) => {
        state.filters.userId = String(event.target?.value || '').trim();
        void loadDevices();
    }, 300));

    document.getElementById('clearRegisteredDeviceFiltersBtn')?.addEventListener('click', () => {
        state.filters = {
            status: '',
            osType: '',
            userId: ''
        };

        const statusFilter = document.getElementById('registeredDeviceStatusFilter');
        const osFilter = document.getElementById('registeredDeviceOsFilter');
        const userIdFilter = document.getElementById('registeredDeviceUserIdFilter');
        if (statusFilter) statusFilter.value = '';
        if (osFilter) osFilter.value = '';
        if (userIdFilter) userIdFilter.value = '';

        void loadDevices();
    });

    document.getElementById('registeredDevicesTableBody')?.addEventListener('click', (event) => {
        void handleDeviceAction(event);
    });
}

export async function initEndpointDevicesPage() {
    await waitForApp();
    state.hasAccess = hasSupportAccess();

    if (!state.hasAccess) {
        renderState({ unauthorized: true });
        return;
    }

    setupEventListeners();
    state.filters = collectFilters();
    await loadDevices();
}

document.addEventListener('DOMContentLoaded', initEndpointDevicesPage);
