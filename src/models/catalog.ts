import { buildAccentChair, buildPlant, buildRug } from './categories/general';
import { buildBathtub, buildShower, buildToilet, buildVanity } from './categories/bathroom';
import { buildDoubleBed, buildDesk, buildNightstand, buildSingleBed, buildWardrobe } from './categories/bedroom';
import { buildDiningChair, buildDiningTable, buildFridge, buildKitchenCabinet, buildStove } from './categories/kitchen';
import { buildBookshelf, buildCoffeeTable, buildFloorLamp, buildSofa, buildTvConsole } from './categories/living';
import type { FurnitureColor, FurnitureDefinition } from './types';

export const FURNITURE_CATALOG = [
  { id: 'bed-double', name: '双人床', category: 'bedroom', dimensions: { width: 1.8, height: 1.1, depth: 2 }, description: '软包床头、双枕与撞色床尾毯', build: buildDoubleBed },
  { id: 'bed-single', name: '单人床', category: 'bedroom', dimensions: { width: 1.05, height: 1.1, depth: 2 }, description: '适合次卧与儿童房的紧凑床型', build: buildSingleBed },
  { id: 'wardrobe', name: '双门衣柜', category: 'bedroom', dimensions: { width: 1.64, height: 2.1, depth: 0.66 }, description: '双门收纳柜，带金属长把手', build: buildWardrobe },
  { id: 'nightstand', name: '床头柜', category: 'bedroom', dimensions: { width: 0.47, height: 0.56, depth: 0.46 }, description: '双层抽屉与细腿床头柜', build: buildNightstand },
  { id: 'desk', name: '书桌', category: 'bedroom', dimensions: { width: 1.2, height: 0.77, depth: 0.6 }, description: '带侧边抽屉的简洁工作桌', build: buildDesk },
  { id: 'sofa', name: '双人沙发', category: 'living', dimensions: { width: 2.2, height: 0.94, depth: 0.9 }, description: '圆润软包、双坐垫与撞色靠枕', build: buildSofa },
  { id: 'coffee-table', name: '茶几', category: 'living', dimensions: { width: 1.1, height: 0.43, depth: 0.6 }, description: '双层收纳设计与圆角桌面', build: buildCoffeeTable },
  { id: 'tv-console', name: '电视柜与电视', category: 'living', dimensions: { width: 1.8, height: 1.3, depth: 0.48 }, description: '三格电视柜搭配薄屏电视', build: buildTvConsole },
  { id: 'bookshelf', name: '书架', category: 'living', dimensions: { width: 0.9, height: 1.8, depth: 0.32 }, description: '四层开放书架与彩色书脊', build: buildBookshelf },
  { id: 'floor-lamp', name: '落地灯', category: 'living', dimensions: { width: 0.6, height: 1.6, depth: 0.6 }, description: '织物灯罩与纤细金属灯杆', build: buildFloorLamp },
  { id: 'dining-table', name: '餐桌', category: 'kitchen', dimensions: { width: 1.4, height: 0.75, depth: 0.8 }, description: '四人圆角实木餐桌', build: buildDiningTable },
  { id: 'dining-chair', name: '餐椅', category: 'kitchen', dimensions: { width: 0.45, height: 0.91, depth: 0.47 }, description: '软垫坐面与弧形靠背', build: buildDiningChair },
  { id: 'fridge', name: '双门冰箱', category: 'kitchen', dimensions: { width: 0.7, height: 1.8, depth: 0.78 }, description: '上冷藏下冷冻的双门冰箱', build: buildFridge },
  { id: 'kitchen-cabinet', name: '橱柜', category: 'kitchen', dimensions: { width: 1.84, height: 0.91, depth: 0.68 }, description: '三联地柜与浅色石材台面', build: buildKitchenCabinet },
  { id: 'stove', name: '灶台', category: 'kitchen', dimensions: { width: 0.6, height: 0.95, depth: 0.67 }, description: '四眼炉灶与嵌入式烤箱', build: buildStove },
  { id: 'toilet', name: '马桶', category: 'bathroom', dimensions: { width: 0.46, height: 0.85, depth: 0.76 }, description: '一体式水箱与椭圆座圈', build: buildToilet },
  { id: 'vanity', name: '洗手台', category: 'bathroom', dimensions: { width: 0.84, height: 1.05, depth: 0.56 }, description: '双门浴室柜、台盆与水龙头', build: buildVanity },
  { id: 'bathtub', name: '浴缸', category: 'bathroom', dimensions: { width: 1.7, height: 0.8, depth: 0.78 }, description: '独立式浴缸与金属入水龙头', build: buildBathtub },
  { id: 'shower', name: '淋浴间', category: 'bathroom', dimensions: { width: 0.9, height: 2.02, depth: 0.9 }, description: '透明玻璃隔断与顶喷花洒', build: buildShower },
  { id: 'plant', name: '绿植', category: 'general', dimensions: { width: 1.05, height: 1.25, depth: 0.65 }, description: '几何阔叶植物与陶土花盆', build: buildPlant },
  { id: 'rug', name: '地毯', category: 'general', dimensions: { width: 2, height: 0.04, depth: 1.4 }, description: '包边织物与简洁菱形纹样', build: buildRug },
  { id: 'accent-chair', name: '单人休闲椅', category: 'general', dimensions: { width: 0.75, height: 0.95, depth: 0.78 }, description: '倾斜靠背与圆润扶手', build: buildAccentChair },
] as const satisfies readonly FurnitureDefinition[];

export type FurnitureModelId = (typeof FURNITURE_CATALOG)[number]['id'];

export function getFurnitureDefinition(id: FurnitureModelId) {
  return FURNITURE_CATALOG.find((item) => item.id === id)!;
}

export function createFurnitureModel(id: FurnitureModelId, color: FurnitureColor = 'walnut') {
  const definition = getFurnitureDefinition(id);
  const model = definition.build(color);
  model.userData.modelId = id;
  model.userData.dimensions = definition.dimensions;
  model.userData.color = color;
  return model;
}
