// Frontend QR Label Generator for OpsMind
// Requires: jsPDF (https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js)
//           qrious (https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js)

document.addEventListener('DOMContentLoaded', () => {
  const printBtn = document.getElementById('printLabelsBtn');
  if (printBtn) {
    printBtn.addEventListener('click', generateLabelsPDF);
  }
});

async function fetchAssets() {
  // You may want to filter or select specific assets
  const res = await fetch('http://localhost:5000/api/assets');
  if (!res.ok) throw new Error('Failed to fetch assets');
  return res.json();
}

async function generateLabelsPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 10;
  try {
    const assets = await fetchAssets();
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      // Generate QR code as data URL
      const qr = new QRious({ value: asset.customId || asset.uniqueId, size: 80 });
      doc.text(`Asset: ${asset.name || asset.assetName || asset.customId || asset.uniqueId}`, 10, y);
      doc.text(`ID: ${asset.customId || asset.uniqueId}`, 10, y + 8);
      doc.addImage(qr.toDataURL(), 'PNG', 150, y - 2, 30, 30);
      y += 40;
      if (y > 260 && i < assets.length - 1) {
        doc.addPage();
        y = 10;
      }
    }
    doc.save('asset-labels.pdf');
  } catch (err) {
    alert('Error generating labels: ' + err.message);
  }
}
