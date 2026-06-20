import { buildPublicAssetVerification } from '../src/services/publicAssetVerificationService';

describe('Public asset verification serializer', () => {
  it('returns only explicitly safe public fields', () => {
    const result = buildPublicAssetVerification({
      assetTag: 'ABC-123',
      type: 'DESKTOP',
      category: 'ASSET',
      location: 'MAIN_BUILDING',
      department: 'COMPUTER_SCIENCE',
      status: 'ACTIVE',
      purchaseCost: 95000,
      vendor: 'Private Vendor',
      serialNumber: 'SECRET-SERIAL',
      assignedToName: 'Private Person',
      specifications: { telemetryId: 'private' },
      notes: 'private note',
      approvalHistory: [{ id: 'private' }],
    } as any);

    expect(result).toEqual({
      registered: true,
      assetTag: 'ABC-123',
      assetType: 'desktop',
      category: 'asset',
      location: 'Main Building',
      building: 'Main Building',
      department: 'Computer Science',
      generalStatus: 'active',
    });
    expect(result).not.toHaveProperty('purchaseCost');
    expect(result).not.toHaveProperty('vendor');
    expect(result).not.toHaveProperty('serialNumber');
    expect(result).not.toHaveProperty('assignedToName');
    expect(result).not.toHaveProperty('specifications');
    expect(result).not.toHaveProperty('notes');
    expect(result).not.toHaveProperty('approvalHistory');
  });

  it('returns a safe registered false response without internal identifiers', () => {
    expect(buildPublicAssetVerification(null, 'MISSING-1')).toEqual({
      registered: false,
      assetTag: 'MISSING-1',
      assetType: null,
      category: null,
      location: null,
      building: null,
      department: null,
      generalStatus: null,
    });
  });
});
