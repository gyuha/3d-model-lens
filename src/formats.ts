/** 이 앱이 다루는 포맷. OBJ/OFF/PLY/PCD/XYZ는 범위 밖이다 (ADR 260822-115455). */
export const SUPPORTED_EXTENSIONS = ['.gltf', '.glb', '.stl'] as const;

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

/**
 * 경로에서 확장자를 뽑는다.
 *
 * 원본 확장은 `node:path` 를 썼지만 이 코드는 브라우저 번들에 들어가므로 직접 자른다.
 * 마지막 경로 구분자 뒤에서만 점을 찾는다 — `../my.dir/model` 처럼 디렉터리에 점이 있는
 * 경로에서 `.dir` 을 확장자로 읽으면 안 된다.
 */
export function extensionOf(pathOrUri: string): string {
  const base = basenameOf(pathOrUri);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

export function basenameOf(pathOrUri: string): string {
  const parts = pathOrUri.split(/[\\/]/);
  return parts[parts.length - 1] ?? pathOrUri;
}

/**
 * Babylon `SceneLoader`에 넘길 `pluginExtension`을 원본 경로에서 뽑는다.
 *
 * asset 프로토콜 URI 에는 쿼리스트링이 붙을 수 있어 Babylon 의 확장자 스니핑이 어긋난다.
 * 그래서 이 함수는 **뷰어 URI 가 아니라 원본 파일 경로**를 받는다. (ADR 260822-115455a)
 */
export function pluginExtensionFor(fsPath: string): SupportedExtension {
  const ext = extensionOf(fsPath);
  const match = SUPPORTED_EXTENSIONS.find((supported) => supported === ext);
  if (!match) {
    return failUnsupported(fsPath, ext);
  }
  return match;
}

export function isSupportedModelPath(fsPath: string): boolean {
  const ext = extensionOf(fsPath);
  return SUPPORTED_EXTENSIONS.some((supported) => supported === ext);
}

function failUnsupported(fsPath: string, ext: string): never {
  const shown = ext === '' ? '(no extension)' : ext;
  throw new Error(
    `Unsupported file type: ${shown} — ${basenameOf(fsPath)}. ` +
      `Supported formats: ${SUPPORTED_EXTENSIONS.join(', ')}`,
  );
}
