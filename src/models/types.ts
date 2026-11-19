import type { Group } from 'three';

export const FURNITURE_CATEGORIES = [
  { id: 'bedroom', name: '卧室' },
  { id: 'living', name: '客厅' },
  { id: 'kitchen', name: '餐厨' },
  { id: 'bathroom', name: '卫浴' },
  { id: 'general', name: '通用' },
] as const;

export type FurnitureCategory = (typeof FURNITURE_CATEGORIES)[number]['id'];
export type FurnitureColor = 'walnut' | 'oak' | 'sage';

export interface FurnitureDimensions {
  width: number;
  height: number;
  depth: number;
}

export interface FurnitureDefinition {
  id: string;
  name: string;
  category: FurnitureCategory;
  dimensions: FurnitureDimensions;
  description: string;
  build: (color: FurnitureColor) => Group;
}
