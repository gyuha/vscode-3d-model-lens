import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'gyuha.vscode-3d-model-lens';
const VIEW_TYPE = 'modelLens.viewer';
const FIXTURES = path.join(__dirname, '..', '..', '..', 'test', 'fixtures');

suite('3D Model Lens — 커스텀 에디터 등록', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('확장이 활성화된다', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `확장을 찾을 수 없습니다: ${EXTENSION_ID}`);
    await extension.activate();
    assert.equal(extension.isActive, true);
  });

  test('package.json 이 gltf / glb / stl 세 포맷을 priority: default 로 기여한다', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const editors = extension.packageJSON.contributes.customEditors as {
      viewType: string;
      priority?: string;
      selector: { filenamePattern: string }[];
    }[];

    const editor = editors.find((e) => e.viewType === VIEW_TYPE);
    assert.ok(editor, `customEditor 기여를 찾을 수 없습니다: ${VIEW_TYPE}`);
    assert.equal(editor.priority, 'default');
    assert.deepEqual(
      editor.selector.map((s) => s.filenamePattern).sort(),
      ['*.glb', '*.gltf', '*.stl'],
    );
  });

  test('Inspector 토글 명령이 등록되고 제목 표시줄·명령 팔레트 양쪽에 노출된다', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('modelLens.toggleInspector'),
      'modelLens.toggleInspector 명령이 등록되지 않았습니다',
    );

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const contributes = extension.packageJSON.contributes;

    const declared = (contributes.commands as { command: string; icon?: string }[]).find(
      (c) => c.command === 'modelLens.toggleInspector',
    );
    assert.ok(declared, '명령 기여가 없습니다');
    assert.equal(declared.icon, '$(inspect)', '제목 표시줄 아이콘이 없습니다');

    for (const location of ['editor/title', 'commandPalette'] as const) {
      const items = (contributes.menus[location] ?? []) as { command: string; when?: string }[];
      const item = items.find((i) => i.command === 'modelLens.toggleInspector');
      assert.ok(item, `${location} 에 노출되지 않았습니다`);
      assert.match(
        item.when ?? '',
        /activeCustomEditorId == 'modelLens\.viewer'/,
        `${location} 의 when 절이 뷰어로 한정되지 않았습니다`,
      );
    }
  });

  test('modelLens.inspectorOnStart 설정이 기여되고 기본값이 false 다', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const property =
      extension.packageJSON.contributes.configuration.properties['modelLens.inspectorOnStart'];
    assert.ok(property, '설정 기여가 없습니다');
    assert.equal(property.type, 'boolean');
    assert.equal(property.default, false);
    assert.equal(
      vscode.workspace.getConfiguration('modelLens').get<boolean>('inspectorOnStart'),
      false,
    );
  });

  test('modelLens.grid 설정이 boolean 으로 기여되고 기본값이 true 다', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const properties = extension.packageJSON.contributes.configuration.properties;

    const grid = properties['modelLens.grid'];
    assert.ok(grid, 'modelLens.grid 기여가 없습니다');
    assert.equal(grid.type, 'boolean');
    assert.equal(grid.default, true, '기본값이 true 여야 한다 — 기존 체감 동작과 같아야 한다');

    assert.equal(vscode.workspace.getConfiguration('modelLens').get<boolean>('grid'), true);
  });

  test('modelLens.background 설정이 3상태 enum 으로 기여되고 기본값이 theme 이다', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const properties = extension.packageJSON.contributes.configuration.properties;

    const background = properties['modelLens.background'];
    assert.ok(background, 'modelLens.background 기여가 없습니다');
    assert.equal(background.default, 'theme');
    assert.deepEqual(background.enum, ['theme', 'light', 'dark']);
    assert.equal(
      background.enumDescriptions.length,
      background.enum.length,
      'enum 과 enumDescriptions 개수가 다릅니다',
    );

    // 같은 것을 다투는 설정이 둘이면 사용자는 "왜 토글이 안 먹히지"를 겪는다 (ADR 260822-195326).
    assert.equal(
      properties['modelLens.backgroundColor'],
      undefined,
      'modelLens.backgroundColor 가 아직 남아 있습니다',
    );

    assert.equal(vscode.workspace.getConfiguration('modelLens').get<string>('background'), 'theme');
  });

  test('modelLens.unit / modelLens.decimals 설정이 기여되고 기본값이 auto / 3 이다', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const properties = extension.packageJSON.contributes.configuration.properties;

    const unit = properties['modelLens.unit'];
    assert.ok(unit, 'modelLens.unit 기여가 없습니다');
    assert.equal(unit.default, 'auto');
    assert.deepEqual(unit.enum, ['auto', 'mm', 'cm', 'm', 'in']);
    assert.equal(
      unit.enumDescriptions.length,
      unit.enum.length,
      'enum 과 enumDescriptions 개수가 다릅니다',
    );

    const decimals = properties['modelLens.decimals'];
    assert.ok(decimals, 'modelLens.decimals 기여가 없습니다');
    assert.equal(decimals.default, 3);
    assert.equal(decimals.minimum, 0);
    assert.equal(decimals.maximum, 10);

    const config = vscode.workspace.getConfiguration('modelLens');
    assert.equal(config.get<string>('unit'), 'auto');
    assert.equal(config.get<number>('decimals'), 3);
  });

  test('측정 모드 토글 명령이 등록되고 제목 표시줄·명령 팔레트 양쪽에 노출된다', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('modelLens.toggleMeasureMode'),
      'modelLens.toggleMeasureMode 명령이 등록되지 않았습니다',
    );

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const contributes = extension.packageJSON.contributes;

    const declared = (contributes.commands as { command: string; icon?: string }[]).find(
      (c) => c.command === 'modelLens.toggleMeasureMode',
    );
    assert.ok(declared, '명령 기여가 없습니다');
    assert.ok(declared.icon, '제목 표시줄 아이콘이 없습니다');

    for (const location of ['editor/title', 'commandPalette'] as const) {
      const items = (contributes.menus[location] ?? []) as { command: string; when?: string }[];
      const item = items.find((i) => i.command === 'modelLens.toggleMeasureMode');
      assert.ok(item, `${location} 에 노출되지 않았습니다`);
      assert.match(item.when ?? '', /activeCustomEditorId == 'modelLens\.viewer'/);
    }
  });

  test('제목 표시줄에서 측정 모드가 Inspector 보다 앞에 온다 — 주 기능이 먼저', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const items = extension.packageJSON.contributes.menus['editor/title'] as {
      command: string;
      group?: string;
    }[];
    const measure = items.find((i) => i.command === 'modelLens.toggleMeasureMode');
    const inspector = items.find((i) => i.command === 'modelLens.toggleInspector');
    assert.ok(measure?.group && inspector?.group);
    assert.ok(
      measure.group < inspector.group,
      `측정(${measure.group}) 이 Inspector(${inspector.group}) 보다 앞이어야 합니다`,
    );
  });

  test('활성 뷰어가 없을 때 토글 명령들이 던지지 않는다', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('modelLens.toggleInspector');
    await vscode.commands.executeCommand('modelLens.toggleMeasureMode');
  });

  for (const fixture of ['cube.glb', 'cube.gltf', 'cube.stl']) {
    test(`${fixture} 를 열면 우리 커스텀 에디터 탭이 활성화된다`, async () => {
      const uri = vscode.Uri.file(path.join(FIXTURES, fixture));
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);

      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      assert.ok(tab, '활성 탭이 없습니다');
      assert.ok(
        tab.input instanceof vscode.TabInputCustom,
        `커스텀 에디터 탭이 아닙니다: ${tab.input?.constructor.name}`,
      );
      assert.equal((tab.input as vscode.TabInputCustom).viewType, VIEW_TYPE);
      assert.equal((tab.input as vscode.TabInputCustom).uri.fsPath, uri.fsPath);
    });
  }
});
