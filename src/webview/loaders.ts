import { RegisterSceneLoaderPlugin } from '@babylonjs/core/Loading/sceneLoader.js';
import { STLFileLoader } from '@babylonjs/loaders/STL/stlFileLoader.pure.js';
import { GLTFFileLoaderMetadata } from '@babylonjs/loaders/glTF/glTFFileLoader.metadata.js';
import { STLFileLoaderMetadata } from '@babylonjs/loaders/STL/stlFileLoader.metadata.js';
import { registerModelLensGLTFExtensions } from './gltfExtensions.js';

/**
 * glTF 와 STL 로더만 등록한다.
 *
 * `registerBuiltInLoaders()` 를 쓰면 안 된다 — BVH / FBX / OBJ / SPLAT 까지 6개를 전부
 * 등록해서 그만큼이 번들에 끌려 들어온다. 아래 방식이면 지원하지 않는 포맷의 로더는
 * 번들에 아예 들어오지 않는다 (ADR 260822-115455).
 *
 * 각 로더는 `await import()` 로 필요할 때 로드되므로 별도 chunk 가 된다 — 로컬 chunk 이고
 * 외부 CDN 요청이 아니다.
 */
export function registerModelLensLoaders(): void {
  RegisterSceneLoaderPlugin({
    ...GLTFFileLoaderMetadata,
    createPlugin: async (options) => {
      const { GLTFFileLoader } = await import('@babylonjs/loaders/glTF/2.0/glTFLoader.js');
      return new GLTFFileLoader(options[GLTFFileLoaderMetadata.name]);
    },
  });
  registerModelLensGLTFExtensions();

  // Babylon 은 기본적으로 STL 의 Y 와 Z 를 맞바꾼다 (STL 은 Z-up, Babylon 은 Y-up).
  // 측정 도구에서는 이게 거짓말이 된다 — 파일이 Z=30 이라 말하는데 뷰어가 Y=30 이라
  // 표시하면 축 라벨을 정직하게 붙여도 값이 틀린다. 파일의 축을 그대로 쓴다.
  // 대가: Z-up 으로 모델링된 CAD 파일은 옆으로 누워 보인다 — 그건 보기 문제일 뿐
  // 값이 틀린 것보다 낫고, 필요하면 시야 방향 조절로 따로 풀 문제다.
  // (ADR 260822-115455c)
  STLFileLoader.DO_NOT_ALTER_FILE_COORDINATES = true;

  RegisterSceneLoaderPlugin({
    ...STLFileLoaderMetadata,
    createPlugin: async () => {
      const { STLFileLoader: STLFileLoaderImpl } = await import(
        '@babylonjs/loaders/STL/stlFileLoader.js'
      );
      return new STLFileLoaderImpl();
    },
  });
}
