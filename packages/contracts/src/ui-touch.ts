const UI_FILE =
  /\.(?:tsx|jsx|vue|svelte|astro|css|scss|sass|less|styl|html?|ejs|hbs|erb|twig|njk|liquid)$|(?:^|\/)(?:components?|pages?|views?|templates?|layouts?|styles?|screens?)\//i;

const UI_WORDS =
  /\b(?:ui|ux|front[- ]?end|css|stylesheets?|layout|buttons?|modal|dialog|navbar|sidebar|tooltip|dropdown|checkbox|responsive|dark mode|landing page|web ?page|home ?page|padding|margin|fonts?|colou?rs?)\b/i;

export function isUiFile(path: string): boolean {
  return UI_FILE.test(path);
}

export function touchesUi(request: string, files: readonly string[]): boolean {
  return files.some(isUiFile) || UI_WORDS.test(request);
}
