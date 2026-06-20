import AuthService from '/services/authService.js';
import {
  buildAuthenticatedInventoryUrl,
  parseInventoryAssetDeepLink,
} from '/assets/js/components/inventoryQrDeepLink.js';

const API_URL = window.OPSMIND_INVENTORY_API_URL || 'http://localhost:5000/api';

function element(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const target = element(id);
  if (target) target.textContent = String(value ?? '-');
}

function setState(title, message, tone = 'info') {
  setText('assetScanTitle', title);
  setText('assetScanMessage', message);
  const status = element('assetScanStatus');
  if (status) status.className = `asset-scan-status is-${tone}`;
}

function loginUrl() {
  const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `/?returnUrl=${encodeURIComponent(returnUrl)}`;
}

function renderVerification(payload, options = {}) {
  const registered = Boolean(payload?.registered);
  const details = element('assetScanDetails');
  const loginAction = element('assetScanLoginAction');
  const dashboardAction = element('assetScanDashboardAction');
  if (!registered) {
    details?.classList.add('d-none');
    setState('Asset not found or unavailable', 'This QR value is not registered, or public verification is unavailable for it.', 'warning');
  } else {
    details?.classList.remove('d-none');
    setText('assetScanRegistered', 'Yes');
    setText('assetScanAssetTag', payload.assetTag || 'Not printed');
    setText('assetScanAssetType', payload.assetType || '-');
    setText('assetScanCategory', payload.category || '-');
    setText('assetScanLocation', payload.location || payload.building || '-');
    setText('assetScanDepartment', payload.department || '-');
    setText('assetScanGeneralStatus', payload.generalStatus || '-');
    setState(
      options.accessLimited ? 'Asset verified — limited access' : 'Asset verified',
      options.accessLimited
        ? 'Your account can verify this asset, but it does not have permission to open Inventory Asset 360.'
        : 'Only non-sensitive registration details are shown on this public page.',
      options.accessLimited ? 'warning' : 'success',
    );
  }
  if (loginAction) {
    loginAction.href = loginUrl();
    loginAction.classList.toggle('d-none', Boolean(options.accessLimited));
  }
  if (dashboardAction) {
    dashboardAction.href = AuthService.resolveUserDashboardContext(AuthService.getCurrentUser()).dashboardPath || '/pages/dashboard.html';
    dashboardAction.classList.toggle('d-none', !options.accessLimited);
  }
}

async function fetchPublicVerification(target) {
  const params = new URLSearchParams();
  if (target.lookupType === 'assetId') params.set('assetId', target.lookupValue);
  else params.set('assetTag', target.lookupValue);
  const response = await fetch(`${API_URL}/inventory/public/asset-verify?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Public verification is temporarily unavailable.');
  return payload;
}

async function initializeAssetScan() {
  const target = parseInventoryAssetDeepLink(window.location.search);
  if (!target) {
    element('assetScanDetails')?.classList.add('d-none');
    element('assetScanLoginAction')?.classList.add('d-none');
    setState('QR link is incomplete', 'This link does not contain an asset tag or stable asset ID.', 'warning');
    return;
  }

  const authenticated = AuthService.isAuthenticated();
  const inventoryRole = authenticated ? AuthService.getInventoryHierarchyRole(AuthService.getCurrentUser()) : null;
  if (authenticated && inventoryRole) {
    setState('Opening Asset 360', 'Asset registration found. Loading the protected CMDB view…', 'info');
    window.location.replace(buildAuthenticatedInventoryUrl(target));
    return;
  }

  try {
    const payload = await fetchPublicVerification(target);
    renderVerification(payload, { accessLimited: authenticated && !inventoryRole });
  } catch {
    element('assetScanDetails')?.classList.add('d-none');
    const loginAction = element('assetScanLoginAction');
    const dashboardAction = element('assetScanDashboardAction');
    if (loginAction) {
      loginAction.href = loginUrl();
      loginAction.classList.toggle('d-none', authenticated);
    }
    if (dashboardAction && authenticated) {
      dashboardAction.href = AuthService.resolveUserDashboardContext(AuthService.getCurrentUser()).dashboardPath || '/pages/dashboard.html';
      dashboardAction.classList.remove('d-none');
    }
    setState('Verification temporarily unavailable', 'No sensitive asset information was exposed. Please try again or sign in.', 'warning');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initializeAssetScan();
});
