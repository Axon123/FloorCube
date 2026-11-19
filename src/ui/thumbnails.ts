import { Box3, DirectionalLight, HemisphereLight, Mesh, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { FURNITURE_CATALOG, createFurnitureModel } from '../models/catalog';

export function generateThumbnails(): Record<string, string> {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(132, 96);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = 'srgb';
  const scene = new Scene();
  scene.add(new HemisphereLight(0xfff4e2, 0x77807a, 2));
  const key = new DirectionalLight(0xffe0b0, 2.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const camera = new PerspectiveCamera(32, 132 / 96, 0.05, 50);
  const result: Record<string, string> = {};

  for (const definition of FURNITURE_CATALOG) {
    const model = createFurnitureModel(definition.id, 'oak');
    scene.add(model);
    const bounds = new Box3().setFromObject(model);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const distance = Math.max(size.x, size.y, size.z) * 1.75 + 0.4;
    camera.position.set(center.x + distance * 0.8, center.y + distance * 0.62, center.z + distance * 0.95);
    camera.lookAt(center);
    renderer.render(scene, camera);
    result[definition.id] = renderer.domElement.toDataURL('image/png');
    scene.remove(model);
    model.traverse((child) => {
      if (child instanceof Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (!material.userData.shared) material.dispose();
        }
      }
    });
  }
  renderer.dispose();
  return result;
}
