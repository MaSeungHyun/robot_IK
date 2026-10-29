# 스타일_코드 관련 안내 문서입니다.

에디터 우측 상단에 `Preview`와 `Markdown`이 있습니다 `Preview`를 클릭하시면 문서를 좀 더 편하게 보실 수 있습니다. ↗↗↗↗↗

모든 스타일은 className에 정의하고, index.css에서 색상 토큰을 정의합니다.

```css
--color-<용도>-<순위?>

ex.
--color-bg-primary

--color-text-primary

--color-icon-primary
--color-icon-hover
--color-icon-active
...
```


## 규칙

1. 아이콘의 경우 네모 박스를 그려주기 위해 <Icon>(자식)이 <Button>(부모)에 들어가있습니다.이때 Hover를 <Icon>에 주면 <Icon> stroke에 Hover를 해야 작동하므로 부모에 `group` 이라는 값을 주어야합니다
2. 그럼 