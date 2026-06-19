import fs from 'fs';
import path from 'path';

describe('Inventory full-kit import regression fixture', () => {
  it('keeps the expected 35-row record type distribution', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'inventory_full_kit_35_rows.csv');
    const lines = fs.readFileSync(fixturePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim());
    const counts = lines.slice(1).reduce<Record<string, number>>((result, line) => {
      const recordType = String(line.split(',', 1)[0] || '').trim();
      result[recordType] = (result[recordType] || 0) + 1;
      return result;
    }, {});

    expect(lines).toHaveLength(36);
    expect(counts).toEqual({
      parent_asset: 10,
      component: 8,
      accessory: 7,
      license: 5,
      consumable: 2,
      spare_stock: 3,
    });
  });
});
