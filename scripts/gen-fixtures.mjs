// 알려진 치수의 테스트 픽스처를 생성한다.
// 파트 3/4의 치수·측정 테스트가 이 값들을 기대값으로 사용하므로,
// 크기를 바꾸면 test/fixtures/FIXTURES.md 도 함께 갱신해야 한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
mkdirSync(OUT, { recursive: true });

/** 원점 중심 직육면체의 정점 8개와 삼각형 인덱스 36개. */
function box(sizeX, sizeY, sizeZ) {
  const [x, y, z] = [sizeX / 2, sizeY / 2, sizeZ / 2];
  const positions = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
  ];
  // 감김 방향은 바깥에서 볼 때 반시계(CCW)여야 한다 — glTF 의 front-face 규약이다.
  // 하나라도 뒤집히면 back-face culling 에 잘려서 "상자 내부가 보이는" 렌더가 된다.
  // `test/unit/fixtures.test.ts` 가 모든 삼각형의 법선이 바깥을 향하는지 검사한다.
  const indices = [
    0, 3, 2, 0, 2, 1, // -Z
    4, 5, 6, 4, 6, 7, // +Z
    0, 4, 7, 0, 7, 3, // -X
    1, 2, 6, 1, 6, 5, // +X
    0, 1, 5, 0, 5, 4, // -Y
    3, 7, 6, 3, 6, 2, // +Y
  ];
  return { positions, indices, min: [-x, -y, -z], max: [x, y, z] };
}

function binaryFor({ positions, indices }) {
  const pos = Buffer.alloc(positions.length * 3 * 4);
  positions.flat().forEach((v, i) => pos.writeFloatLE(v, i * 4));
  const idx = Buffer.alloc(indices.length * 2);
  indices.forEach((v, i) => idx.writeUInt16LE(v, i * 2));
  return { pos, idx, buffer: Buffer.concat([pos, idx]) };
}

function gltfJson(geo, bin, bufferSpec) {
  return {
    asset: { version: '2.0', generator: '3d-model-lens fixture generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'FixtureBox' }],
    meshes: [{ name: 'FixtureBox', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [bufferSpec],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: bin.pos.length, target: 34962 },
      { buffer: 0, byteOffset: bin.pos.length, byteLength: bin.idx.length, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: geo.positions.length,
        type: 'VEC3',
        min: geo.min,
        max: geo.max,
      },
      { bufferView: 1, componentType: 5123, count: geo.indices.length, type: 'SCALAR' }, // UNSIGNED_SHORT
    ],
  };
}

// --- cube.gltf (+ 외부 cube.bin) — 형제 파일 해결을 실제로 검증하기 위해 임베디드로 만들지 않는다.
{
  const geo = box(2, 3, 4);
  const bin = binaryFor(geo);
  const json = gltfJson(geo, bin, { uri: 'cube.bin', byteLength: bin.buffer.length });
  writeFileSync(join(OUT, 'cube.bin'), bin.buffer);
  writeFileSync(join(OUT, 'cube.gltf'), JSON.stringify(json, null, 2) + '\n');
}

// --- cube.glb (바이너리 컨테이너)
{
  const geo = box(5, 6, 7);
  const bin = binaryFor(geo);
  const json = gltfJson(geo, bin, { byteLength: bin.buffer.length });

  const pad = (buf, filler) => {
    const rem = buf.length % 4;
    return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, filler)]);
  };
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20); // 공백으로 패딩
  const binChunk = pad(bin.buffer, 0x00);

  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  const chunk = (data, type) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.write(type, 4, 'ascii');
    return Buffer.concat([head, data]);
  };
  writeFileSync(
    join(OUT, 'cube.glb'),
    Buffer.concat([header, chunk(jsonChunk, 'JSON'), chunk(binChunk, 'BIN\0')]),
  );
}

function asciiStl(geo, name) {
  const lines = [`solid ${name}`];
  for (let i = 0; i < geo.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => geo.positions[geo.indices[i + k]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    const nn = n.map((k) => k / len);
    lines.push(`  facet normal ${nn.map((k) => k.toExponential(6)).join(' ')}`);
    lines.push('    outer loop');
    for (const p of [a, b, c]) {
      lines.push(`      vertex ${p.map((k) => k.toExponential(6)).join(' ')}`);
    }
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${name}`, '');
  return lines.join('\n');
}

// --- cube.stl (ASCII)
writeFileSync(join(OUT, 'cube.stl'), asciiStl(box(10, 20, 30), 'fixture_cube'));

// --- cube_large.stl — cube.stl 의 100배. 마커·그리드·카메라가 스케일에 비례하는지 검증용.
{
  const geo = box(1000, 2000, 3000);
  writeFileSync(join(OUT, 'cube_large.stl'), asciiStl(geo, 'fixture_cube_large'));
}

// --- broken.glb — 0바이트. 에러 UI 검증용.
writeFileSync(join(OUT, 'broken.glb'), Buffer.alloc(0));

console.log('픽스처 생성 완료:', OUT);
