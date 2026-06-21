import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import AuthService from '../../services/authService.js';
import {
  buildAuthenticatedInventoryUrl,
  buildInventoryAssetQrUrl,
  parseInventoryAssetDeepLink,
  resolveInventoryAssetDeepLink,
} from '../../assets/js/components/inventoryQrDeepLink.js';

test('QR URL generation prefers a production-safe assetTag deep link', () => {
  const url = buildInventoryAssetQrUrl(
    { customId: 'INTERNAL-1', assetTag: 'ABC-123' },
    { baseUrl: 'https://opsmind.example' },
  );
  assert.equal(url, 'https://opsmind.example/assets/scan?assetTag=ABC-123');
  assert.equal(url.includes('INTERNAL-1'), false);
});

test('assetTag query resolves the exact asset after inventory data loads', () => {
  const target = parseInventoryAssetDeepLink('?assetTag=ABC-123');
  const assets = [
    { customId: 'A-1', assetTag: 'ABC-12' },
    { customId: 'A-2', assetTag: 'ABC-123' },
  ];
  assert.equal(resolveInventoryAssetDeepLink(assets, target)?.customId, 'A-2');
  assert.equal(
    buildAuthenticatedInventoryUrl(target, { baseUrl: 'https://opsmind.example' }),
    'https://opsmind.example/pages/inventory.html?assetTag=ABC-123',
  );
});

test('assetId and openAsset never fall back to an unrelated partial match', () => {
  const assets = [{ customId: 'ASSET-10', assetTag: 'TAG-10' }];
  assert.equal(resolveInventoryAssetDeepLink(assets, parseInventoryAssetDeepLink('?assetId=ASSET-1')), null);
  assert.equal(resolveInventoryAssetDeepLink(assets, parseInventoryAssetDeepLink('?openAsset=TAG-10'))?.customId, 'ASSET-10');
});

test('duplicate human-readable tags do not resolve to the wrong asset', () => {
  const target = parseInventoryAssetDeepLink('?assetTag=DUPLICATE-TAG');
  const assets = [
    { customId: 'ASSET-1', assetTag: 'DUPLICATE-TAG' },
    { customId: 'ASSET-2', assetTag: 'DUPLICATE-TAG' },
  ];
  assert.equal(resolveInventoryAssetDeepLink(assets, target), null);
});

test('login return URLs are same-origin only', () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    location: {
      origin: 'https://opsmind.example',
      pathname: '/',
      search: '?returnUrl=%2Fassets%2Fscan%3FassetTag%3DABC-123',
      hash: '',
    },
  };
  try {
    assert.equal(AuthService.getSafeReturnUrl(), '/assets/scan?assetTag=ABC-123');
    assert.equal(AuthService.getSafeReturnUrl('?returnUrl=https%3A%2F%2Fevil.example%2Fsteal'), null);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('authenticated Inventory startup resolves the deep link then opens Asset 360', async () => {
  const source = await readFile(new URL('../../assets/js/pages/inventory.js', import.meta.url), 'utf8');
  const standaloneLabels = await readFile(new URL('../../assets/js/print_labels.js', import.meta.url), 'utf8');
  assert.match(source, /await openInventoryDeepLinkAfterLoad\(\)/);
  assert.match(source, /await window\.openAssetCmdb\(asset\.customId\)/);
  assert.match(standaloneLabels, /buildInventoryAssetQrUrl\(asset\)/);
  assert.match(standaloneLabels, /new QRious\(\{ value: deepLink/);
  assert.doesNotMatch(standaloneLabels, /new QRious\(\{ value: asset\.(?:customId|assetTag)/);
});

test('QR modal owns a body-mounted backdrop and cleans only QR artifacts', async () => {
  const source = await readFile(new URL('../../assets/js/pages/inventory.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../../assets/css/main.css', import.meta.url), 'utf8');
  const qrBlock = source.slice(source.indexOf('window.viewQRCode ='), source.indexOf('window.printQRLabels ='));
  assert.match(qrBlock, /document\.body\.append\(backdrop, modal\)/);
  assert.match(qrBlock, /data-inventory-qr-close/);
  assert.match(qrBlock, /event\.stopImmediatePropagation\(\)/);
  assert.doesNotMatch(qrBlock, /bootstrap\.Modal|specModal/);
  assert.match(source, /getElementById\(INVENTORY_QR_MODAL_ID\)\?\.remove\(\)/);
  assert.match(source, /getElementById\(INVENTORY_QR_BACKDROP_ID\)\?\.remove\(\)/);
  assert.match(css, /\.inventory-qr-backdrop[\s\S]*?z-index:\s*3600/);
  assert.match(css, /\.inventory-qr-modal[\s\S]*?pointer-events:\s*none[\s\S]*?z-index:\s*3610/);
  assert.match(css, /\.inventory-qr-dialog[\s\S]*?pointer-events:\s*auto/);
});
