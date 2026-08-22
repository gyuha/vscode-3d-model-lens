import * as path from 'node:path';

/**
 * 웹뷰의 `localResourceRoots`로 쓸 디렉터리 목록을 계산한다.
 *
 * 참고 레포(tatsy/vscode-3d-preview)는 워크스페이스 폴더만 허용해서
 * "워크스페이스 밖 파일을 열면 빈 화면"이라는 버그를 FAQ로 문서화해 놨다.
 * 파일의 디렉터리를 항상 함께 허용하면 그 문제가 애초에 생기지 않는다.
 *
 * 상위 디렉터리(`../textures/`)를 참조하는 모델은 여전히 실패할 수 있다 —
 * 파일 시스템 루트를 열어주는 것보다는 그 편이 낫다는 의도된 한계다.
 * (ADR 260822-115455a)
 */
export function computeLocalResourceRootPaths(
  modelFsPath: string,
  workspaceFolderFsPath: string | undefined,
  extensionFsPath: string,
): string[] {
  const candidates = [extensionFsPath, workspaceFolderFsPath, path.dirname(modelFsPath)].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );

  const roots: string[] = [];
  for (const candidate of candidates) {
    // 이미 허용된 루트에 포함되는 경로는 추가하지 않는다.
    if (roots.some((existing) => isSameOrInside(candidate, existing))) {
      continue;
    }
    roots.push(candidate);
  }
  return roots;
}

/** `child`가 `parent`와 같거나 그 안에 있는지 — 접두사 문자열 비교가 아니라 경로 경계로 판단한다. */
function isSameOrInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
