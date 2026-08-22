# 3D Model Lens — 브랜치 추가 용어

> 이 파일은 브랜치 `fix/render-gate-and-animation` 에서 추가된 용어만 담는다.
> 기본 용어집은 최상위 `.forge/CONTEXT.md` 이며, 읽을 때 두 파일이 겹쳐진다
> (FORGE-ROOT.md 의 read overlay).

## Language

**배경 모드 (Background Mode)**:
뷰어 캔버스 뒤에 보이는 색을 결정하는 세 값 중 하나 — `theme` · `light` · `dark`.
`theme` 은 VS Code 편집기 배경색을 따라가고, 나머지 둘은 그것과 무관하게 고정한다.
**모델의 색이 아니라 모델이 놓인 바탕의 색**이며, 사람 단위로 정해지는 것이지
파일마다 다를 이유가 없는 값이다(그래서 전역 설정에 저장한다).
_Avoid_: 배경색, 테마, 다크 모드
