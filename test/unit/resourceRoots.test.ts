import { describe, expect, it } from 'vitest';
import { computeLocalResourceRootPaths } from '../../src/resourceRoots';

const EXT = '/opt/ext/vscode-3d-model-lens';

describe('computeLocalResourceRootPaths', () => {
  it('워크스페이스 안의 파일이면 확장 디렉터리와 워크스페이스 폴더만 반환한다 (파일 디렉터리는 워크스페이스에 포함되므로 생략)', () => {
    expect(
      computeLocalResourceRootPaths('/work/proj/models/cube.glb', '/work/proj', EXT),
    ).toEqual([EXT, '/work/proj']);
  });

  it('워크스페이스가 열려 있지 않으면 확장 디렉터리와 파일의 디렉터리를 반환한다', () => {
    expect(computeLocalResourceRootPaths('/tmp/downloads/cube.glb', undefined, EXT)).toEqual([
      EXT,
      '/tmp/downloads',
    ]);
  });

  it('워크스페이스 밖의 파일이면 확장 디렉터리, 워크스페이스 폴더, 파일 디렉터리를 모두 반환한다', () => {
    expect(
      computeLocalResourceRootPaths('/tmp/downloads/cube.glb', '/work/proj', EXT),
    ).toEqual([EXT, '/work/proj', '/tmp/downloads']);
  });

  it('파일이 워크스페이스 루트에 바로 있으면 워크스페이스 폴더를 중복해서 넣지 않는다', () => {
    expect(computeLocalResourceRootPaths('/work/proj/cube.glb', '/work/proj', EXT)).toEqual([
      EXT,
      '/work/proj',
    ]);
  });

  it('접두사만 같고 실제로는 형제인 디렉터리를 포함 관계로 오판하지 않는다', () => {
    expect(
      computeLocalResourceRootPaths('/work/proj-other/cube.glb', '/work/proj', EXT),
    ).toEqual([EXT, '/work/proj', '/work/proj-other']);
  });
});
