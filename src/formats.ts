import * as path from 'node:path';

/** 이 확장이 다루는 포맷. OBJ/OFF/PLY/PCD/XYZ는 범위 밖이다 (ADR 260822-115455). */
export const SUPPORTED_EXTENSIONS = ['.gltf', '.glb', '.stl'] as const;

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

/**
 * Babylon `SceneLoader`에 넘길 `pluginExtension`을 원본 경로에서 뽑는다.
 *
 * 웹뷰 URI는 `.../cube.glb?nonce=...` 처럼 쿼리스트링이 붙어 Babylon의
 * 확장자 스니핑이 어긋날 수 있으므로, 로드 시 이 값을 명시적으로 넘긴다.
 * 그래서 이 함수는 **웹뷰 URI가 아니라 원본 파일 경로**를 받는다.
 * (ADR 260822-115455a)
 */
export function pluginExtensionFor(fsPath: string): SupportedExtension {
  const ext = path.extname(fsPath).toLowerCase();
  const match = SUPPORTED_EXTENSIONS.find((supported) => supported === ext);
  if (!match) {
    return failUnsupported(fsPath, ext);
  }
  return match;
}

export function isSupportedModelPath(fsPath: string): boolean {
  const ext = path.extname(fsPath).toLowerCase();
  return SUPPORTED_EXTENSIONS.some((supported) => supported === ext);
}

function failUnsupported(fsPath: string, ext: string): never {
  const shown = ext === '' ? '(확장자 없음)' : ext;
  throw new Error(
    `지원하지 않는 파일 형식입니다: ${shown} — ${path.basename(fsPath)}. ` +
      `지원 포맷: ${SUPPORTED_EXTENSIONS.join(', ')}`,
  );
}
