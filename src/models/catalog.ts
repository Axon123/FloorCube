import { buildAccentChair, buildCoatRack, buildOttoman, buildPlant, buildRug, buildShoeCabinet } from './categories/general';
import { buildBathtub, buildShower, buildToilet, buildVanity, buildWashingMachine } from './categories/bathroom';
import { buildDoubleBed, buildDesk, buildDresser, buildDressingTable, buildNightstand, buildSingleBed, buildWardrobe } from './categories/bedroom';
import { buildBarStool, buildDiningChair, buildDiningTable, buildFridge, buildKitchenCabinet, buildKitchenIsland, buildRoundDiningTable, buildStove } from './categories/kitchen';
import { buildBookshelf, buildCoffeeTable, buildFloorLamp, buildSectionalSofa, buildSideboard, buildSideTable, buildSofa, buildTvConsole } from './categories/living';
import type { FurnitureColor, FurnitureDefinition } from './types';

export const FURNITURE_CATALOG = [
  { id: 'bed-double', name: '双人床', category: 'bedroom', dimensions: { width: 1.8, height: 1.1, depth: 2 }, description: '分格软包床头、蓬松双枕与织物包边', build: buildDoubleBed },
  { id: 'bed-single', name: '单人床', category: 'bedroom', dimensions: { width: 1.05, height: 1.1, depth: 2 }, description: '软包床头、层次床品与折边盖毯', build: buildSingleBed },
  { id: 'wardrobe', name: '双门衣柜', category: 'bedroom', dimensions: { width: 1.64, height: 2.1, depth: 0.66 }, description: '实木门框、内嵌门板与金属长把手', build: buildWardrobe },
  { id: 'nightstand', name: '床头柜', category: 'bedroom', dimensions: { width: 0.47, height: 0.56, depth: 0.46 }, description: '圆角木台面、分层抽屉与精细五金', build: buildNightstand },
  { id: 'desk', name: '书桌', category: 'bedroom', dimensions: { width: 1.2, height: 0.77, depth: 0.6 }, description: '实木工作桌、侧抽屉与支撑横梁', build: buildDesk },
  { id: 'dresser', name: '六斗柜', category: 'bedroom', dimensions: { width: 1.2, height: 0.9, depth: 0.48 }, description: '六格分层抽屉与实木收边', build: buildDresser },
  { id: 'dressing-table', name: '梳妆台', category: 'bedroom', dimensions: { width: 1, height: 1.5, depth: 0.5 }, description: '圆镜、收纳抽屉与轻盈木质桌架', build: buildDressingTable },
  { id: 'sofa', name: '双人沙发', category: 'living', dimensions: { width: 2.2, height: 0.94, depth: 0.9 }, description: '饱满软包、独立坐背垫与精细压边', build: buildSofa },
  { id: 'sectional-sofa', name: '转角沙发', category: 'living', dimensions: { width: 2.8, height: 0.96, depth: 1.65 }, description: 'L 形贵妃位、分区软垫与撞色抱枕', build: buildSectionalSofa },
  { id: 'coffee-table', name: '茶几', category: 'living', dimensions: { width: 1.1, height: 0.43, depth: 0.6 }, description: '圆角木纹桌面、下层置物板与锥形腿', build: buildCoffeeTable },
  { id: 'side-table', name: '圆边几', category: 'living', dimensions: { width: 0.5, height: 0.58, depth: 0.5 }, description: '圆润桌沿与雕塑感底座', build: buildSideTable },
  { id: 'tv-console', name: '电视柜与电视', category: 'living', dimensions: { width: 1.8, height: 1.3, depth: 0.48 }, description: '分区储物柜、金属五金与窄边薄屏', build: buildTvConsole },
  { id: 'bookshelf', name: '书架', category: 'living', dimensions: { width: 0.9, height: 1.8, depth: 0.32 }, description: '开放层板、精细书脊与陈列摆件', build: buildBookshelf },
  { id: 'sideboard', name: '餐边柜', category: 'living', dimensions: { width: 1.5, height: 0.9, depth: 0.45 }, description: '木质柜门、分格收纳与细腿底架', build: buildSideboard },
  { id: 'floor-lamp', name: '落地灯', category: 'living', dimensions: { width: 0.6, height: 1.6, depth: 0.6 }, description: '中空织物灯罩、包边与内置灯泡', build: buildFloorLamp },
  { id: 'dining-table', name: '餐桌', category: 'kitchen', dimensions: { width: 1.4, height: 0.75, depth: 0.8 }, description: '圆角实木桌板、裙板与锥形桌腿', build: buildDiningTable },
  { id: 'round-dining-table', name: '圆餐桌', category: 'kitchen', dimensions: { width: 1.1, height: 0.76, depth: 1.1 }, description: '圆形木纹桌板与中央支撑底座', build: buildRoundDiningTable },
  { id: 'dining-chair', name: '餐椅', category: 'kitchen', dimensions: { width: 0.45, height: 0.91, depth: 0.47 }, description: '弧形靠背、织物坐垫与精细木架', build: buildDiningChair },
  { id: 'bar-stool', name: '吧椅', category: 'kitchen', dimensions: { width: 0.48, height: 0.95, depth: 0.48 }, description: '软垫高座、低靠背与环形脚踏', build: buildBarStool },
  { id: 'fridge', name: '双门冰箱', category: 'kitchen', dimensions: { width: 0.7, height: 1.8, depth: 0.78 }, description: '分体柜门、控制面板与金属门把手', build: buildFridge },
  { id: 'kitchen-cabinet', name: '橱柜', category: 'kitchen', dimensions: { width: 1.84, height: 0.91, depth: 0.68 }, description: '石材台面、内嵌门板与分层抽屉', build: buildKitchenCabinet },
  { id: 'kitchen-island', name: '厨房岛台', category: 'kitchen', dimensions: { width: 1.5, height: 0.94, depth: 0.85 }, description: '悬挑石材台面与开放储物空间', build: buildKitchenIsland },
  { id: 'stove', name: '灶台', category: 'kitchen', dimensions: { width: 0.6, height: 0.95, depth: 0.67 }, description: '四眼炉架、旋钮与玻璃烤箱门', build: buildStove },
  { id: 'toilet', name: '马桶', category: 'bathroom', dimensions: { width: 0.46, height: 0.85, depth: 0.76 }, description: '平滑陶瓷内壁、椭圆座圈与冲水按键', build: buildToilet },
  { id: 'vanity', name: '洗手台', category: 'bathroom', dimensions: { width: 0.84, height: 1.05, depth: 0.56 }, description: '木质浴室柜、中空台盆与弯管龙头', build: buildVanity },
  { id: 'bathtub', name: '浴缸', category: 'bathroom', dimensions: { width: 1.7, height: 0.8, depth: 0.78 }, description: '一体曲面缸体、内壁与金属龙头', build: buildBathtub },
  { id: 'shower', name: '淋浴间', category: 'bathroom', dimensions: { width: 0.9, height: 2.02, depth: 0.9 }, description: '通透玻璃、金属五金与顶喷花洒', build: buildShower },
  { id: 'washing-machine', name: '滚筒洗衣机', category: 'bathroom', dimensions: { width: 0.62, height: 0.86, depth: 0.66 }, description: '玻璃舱门、内滚筒与精细控制面板', build: buildWashingMachine },
  { id: 'plant', name: '绿植', category: 'general', dimensions: { width: 1.05, height: 1.25, depth: 0.65 }, description: '自然舒展的曲面叶片、叶脉与陶土盆', build: buildPlant },
  { id: 'rug', name: '地毯', category: 'general', dimensions: { width: 2, height: 0.04, depth: 1.4 }, description: '细密织纹、分层包边与流苏', build: buildRug },
  { id: 'accent-chair', name: '单人休闲椅', category: 'general', dimensions: { width: 0.75, height: 0.95, depth: 0.78 }, description: '开放式实木扶手、软包靠背与腰枕', build: buildAccentChair },
  { id: 'shoe-cabinet', name: '玄关鞋柜', category: 'general', dimensions: { width: 1, height: 1.1, depth: 0.4 }, description: '双层翻斗门板、透气格栅与金属把手', build: buildShoeCabinet },
  { id: 'coat-rack', name: '衣帽架', category: 'general', dimensions: { width: 0.56, height: 1.78, depth: 0.56 }, description: '实木立杆、错落挂钩与稳固圆底座', build: buildCoatRack },
  { id: 'ottoman', name: '软包圆凳', category: 'general', dimensions: { width: 0.65, height: 0.45, depth: 0.65 }, description: '鼓形软包、分瓣缝线与木质底座', build: buildOttoman },
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
