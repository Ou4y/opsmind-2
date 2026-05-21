// File: src/services/history-service/index.ts

import { EventBus } from '../EventBus';
import { TOPICS } from '../../events/assetEvents';
import HistoryService from '../../models/History';

const eventHistory = (data: any, fallbackAction: string, fallbackDetails: string) => ({
  action: data?.historyAction ? String(data.historyAction) : fallbackAction,
  details: data?.historyDetails ? String(data.historyDetails) : fallbackDetails,
});

const startHistoryService = async () => {
  console.log('History Service listening for asset events...');

  await EventBus.subscribe(TOPICS.ASSET_CREATED, async (data: any) => {
    console.log(`[EVENT RECEIVED] Asset Created: ${data.customId}`);
    if (!data?.customId) return;
    const history = eventHistory(
      data,
      'CREATED',
      `Initial batch of ${data.quantity} created at ${data.location}`
    );

    await HistoryService.createHistory({
      assetId: data.customId,
      action: history.action,
      details: history.details,
    });
  });

  await EventBus.subscribe(TOPICS.ASSET_TRANSFERRED, async (data: any) => {
    console.log(`[EVENT RECEIVED] Asset Transferred: ${data.customId}`);
    if (!data?.customId) return;
    const quantityMoved = Number(data.quantityMoved || data.quantity || 0);
    const destination = String(data.destination || data.location || data.department || 'unknown');
    const history = eventHistory(
      data,
      'TRANSFERRED',
      `Moved ${quantityMoved > 0 ? quantityMoved : ''} to ${destination}`.trim()
    );

    await HistoryService.createHistory({
      assetId: data.customId,
      action: history.action,
      details: history.details,
    });
  });

  await EventBus.subscribe(TOPICS.ASSET_UPDATED, async (data: any) => {
    console.log(`[EVENT RECEIVED] Asset Updated: ${data.customId}`);
    if (!data?.customId) return;
    const fields = Array.isArray(data.fields) ? data.fields.join(', ') : 'unknown fields';
    const history = eventHistory(data, 'UPDATED', `Fields changed: ${fields}`);

    await HistoryService.createHistory({
      assetId: data.customId,
      action: history.action,
      details: history.details,
    });
  });

  await EventBus.subscribe(TOPICS.ASSET_DELETED, async (data: any) => {
    console.log(`[EVENT RECEIVED] Asset Deleted: ${data.customId}`);
    if (!data?.customId) return;
    const history = eventHistory(data, 'DELETED', 'Permanently removed from database');

    await HistoryService.createHistory({
      assetId: data.customId,
      action: history.action,
      details: history.details,
    });
  });
};

export default startHistoryService;
