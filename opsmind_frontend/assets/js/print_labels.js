import AuthService from '/services/authService.js';
import { buildInventoryAssetQrUrl } from '/assets/js/components/inventoryQrDeepLink.js';

function setStatus(message, tone = 'info') {
  const status = document.getElementById('labelStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `asset-label-printer-status is-${tone}`;
}

document.addEventListener('DOMContentLoaded', () => {
  if (!AuthService.isAuthenticated() || !AuthService.canInventoryAction('print_label')) {
    window.location.href = AuthService.getLoginUrlForReturn();
    return;
  }
  document.getElementById('printLabelsBtn')?.addEventListener('click', generateLabelsPDF);
});

async function fetchAssets() {
  const inventoryApiBase = String(window.OPSMIND_INVENTORY_API_URL || '').replace(/\/+$/, '');
  if (!inventoryApiBase) throw new Error('Inventory API URL is not configured.');
  const params = new URLSearchParams({ paginate: 'true', page: '1', pageSize: '500' });
  const response = await fetch(`${inventoryApiBase}/assets?${params.toString()}`, {
    headers: AuthService.getInventoryAuthHeaders(),
  });
  if (response.status === 401) {
    AuthService.clearAuth();
    window.location.href = AuthService.getLoginUrlForReturn();
    throw new Error('Session expired. Please sign in again.');
  }
  if (!response.ok) throw new Error('Asset labels are unavailable for this account.');
  const payload = await response.json();
  return Array.isArray(payload) ? payload : (Array.isArray(payload?.assets) ? payload.assets : []);
}

async function generateLabelsPDF() {
  const button = document.getElementById('printLabelsBtn');
  if (button) button.disabled = true;
  setStatus('Preparing secure QR labels…');
  try {
    const assets = await fetchAssets();
    if (!assets.length) throw new Error('No assets are available for label generation.');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 10;
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index];
      const deepLink = buildInventoryAssetQrUrl(asset);
      const qr = new QRious({ value: deepLink, size: 120 });
      const assetTag = String(asset.assetTag || '').trim();
      doc.text(`Asset: ${asset.name || asset.customId || 'OpsMind asset'}`, 10, y);
      doc.text(`Asset Tag: ${assetTag || 'Not assigned'}`, 10, y + 8);
      doc.text(`ID: ${asset.customId || 'N/A'}`, 10, y + 16);
      doc.addImage(qr.toDataURL(), 'PNG', 150, y - 2, 30, 30);
      y += 40;
      if (y > 260 && index < assets.length - 1) {
        doc.addPage();
        y = 10;
      }
    }
    doc.save('asset-labels.pdf');
    setStatus(`Generated ${assets.length} secure asset label(s).`, 'success');
  } catch (error) {
    setStatus(error.message || 'Could not generate asset labels.', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}
