import express from 'express';
import {
  BUILDINGS,
  DEPARTMENTS,
  ASSET_TYPES,
  COMPONENT_TYPE_REGISTRY_BY_PARENT,
  ACCESSORY_TYPES,
  CONSUMABLE_TYPES,
  SPARE_STOCK_TYPES,
  LICENSE_TYPES,
  EOL_METRICS
} from '../config/constants';

const router = express.Router();

router.get('/', (req, res) => {
  // Using shorthand syntax here automatically sends the keys exactly as named 
  // (e.g., BUILDINGS) to match what the frontend fetch function expects!
  res.json({
    BUILDINGS,
    DEPARTMENTS,
    ASSET_TYPES,
    COMPONENT_TYPE_REGISTRY_BY_PARENT,
    ACCESSORY_TYPES,
    CONSUMABLE_TYPES,
    SPARE_STOCK_TYPES,
    LICENSE_TYPES,
    EOL_METRICS
  });
});

export default router;
