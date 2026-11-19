import type { FurnitureColor } from './types';

export interface FurniturePalette {
  id: FurnitureColor;
  name: string;
  swatch: string;
  wood: number;
  fabric: number;
  accent: number;
}

export const FURNITURE_PALETTES: Record<FurnitureColor, FurniturePalette> = {
  walnut: {
    id: 'walnut',
    name: '胡桃木',
    swatch: '#8b624c',
    wood: 0x76513d,
    fabric: 0xc58f78,
    accent: 0xe1b36a,
  },
  oak: {
    id: 'oak',
    name: '暖原木',
    swatch: '#c9a574',
    wood: 0xbc9262,
    fabric: 0xd8c7a7,
    accent: 0x76958c,
  },
  sage: {
    id: 'sage',
    name: '鼠尾草',
    swatch: '#7e9787',
    wood: 0x7d8870,
    fabric: 0x78998b,
    accent: 0xd4a373,
  },
};

export const NEUTRALS = {
  cream: 0xf3eee4,
  white: 0xf7f6f1,
  dark: 0x303735,
  metal: 0x8d9692,
  glass: 0xa9d1d2,
  water: 0x8fc6d1,
  leaf: 0x53745a,
  leafLight: 0x76936b,
  soil: 0x4a382d,
} as const;
