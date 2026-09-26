// Runs against the loaded document in an isolated world, without app preload or Node access.
// Rebuild the document from safe elements/attributes instead of serializing executable page markup.
export const PAGE_DESIGN_SCRIPT = String.raw`(() => {
  const MAX_NODES = 25000;
  const MAX_LENGTH = 12 * 1024 * 1024;
  const startedAt = Date.now();
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const warnings = new Set();
  const classes = new Map();
  const rules = [];
  let nodes = 0;
  let length = 0;
  const account = amount => {
    length += amount;
    if (length > MAX_LENGTH) throw new Error('网页内容过大，无法生成设计稿（上限 12 MB）。');
  };
  const htmlTags = new Set(('html body div span main section article header footer nav aside h1 h2 h3 h4 h5 h6 p a abbr b bdi bdo blockquote br cite code dd del details dfn dialog dl dt em figcaption figure hr i ins kbd li mark menu ol pre q rp rt ruby s samp small strong sub summary sup time u ul var wbr table caption col colgroup tbody td tfoot th thead tr button fieldset legend input label meter optgroup option output progress select textarea img picture audio video').split(' '));
  const svgTags = new Set(('svg a g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath linearGradient radialGradient stop pattern clipPath mask marker image filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence desc').split(' ').map(tag => tag.toLowerCase()));
  const discarded = new Set(('script style link meta base iframe frame frameset object embed applet template noscript source track portal').split(' '));
  const commonAttributes = new Set(('id title lang dir role aria-label aria-hidden aria-labelledby aria-describedby colspan rowspan span scope headers open reversed start low high min max optimum step placeholder multiple size rows cols wrap disabled readonly required checked selected').split(' '));
  const svgAttributes = new Set(('viewbox preserveaspectratio x y x1 y1 x2 y2 cx cy r rx ry dx dy d points width height transform fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity vector-effect paint-order text-anchor dominant-baseline alignment-baseline textlength lengthadjust rotate gradientunits gradienttransform offset spreadmethod patternunits patterncontentunits patterntransform markerwidth markerheight markerunits refx refy orient clippathunits maskunits maskcontentunits filterunits primitiveunits in in2 result type values mode operator k1 k2 k3 k4 stddeviation edgemode kernelmatrix kernelunitlength order targetx targety divisor bias preservealpha scale xchannelselector ychannelselector surfaceScale diffuseconstant specularconstant specularexponent limitingconeangle azimuth elevation pointsatx pointsaty pointsatz z basefrequency numoctaves seed stitchtiles').toLowerCase().split(' '));
  // Computed styles remove the dependency on remote selectors and stylesheets. Repeated styles share a class.
  const properties = ('display visibility box-sizing position top right bottom left z-index float clear width min-width max-width height min-height max-height margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left overflow-x overflow-y overflow-wrap overflow-anchor vertical-align isolation contain content-visibility flex-direction flex-wrap flex-grow flex-shrink flex-basis justify-content justify-items justify-self align-content align-items align-self order row-gap column-gap grid-template-columns grid-template-rows grid-auto-columns grid-auto-rows grid-auto-flow grid-column-start grid-column-end grid-row-start grid-row-end grid-template-areas color background-color background-image background-position background-size background-repeat background-origin background-clip background-attachment background-blend-mode border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style border-top-color border-right-color border-bottom-color border-left-color border-top-left-radius border-top-right-radius border-bottom-right-radius border-bottom-left-radius border-image-source border-image-slice border-image-width border-image-outset border-image-repeat border-collapse border-spacing table-layout caption-side empty-cells outline-width outline-style outline-color outline-offset box-shadow opacity mix-blend-mode filter backdrop-filter transform transform-origin transform-style perspective perspective-origin backface-visibility clip-path mask-image mask-size mask-position mask-repeat object-fit object-position aspect-ratio font-family font-size font-weight font-style font-stretch font-variant font-feature-settings font-variation-settings line-height letter-spacing word-spacing text-align text-align-last text-indent text-transform text-decoration-line text-decoration-color text-decoration-style text-decoration-thickness text-underline-offset text-shadow text-overflow white-space word-break hyphens tab-size writing-mode direction unicode-bidi list-style-type list-style-position list-style-image columns column-count column-width column-fill column-rule-width column-rule-style column-rule-color appearance accent-color color-scheme cursor resize user-select fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset paint-order vector-effect stop-color stop-opacity flood-color flood-opacity lighting-color text-anchor dominant-baseline alignment-baseline').split(' ');
  properties.push('translate', 'rotate', 'scale');
  const sensitiveParameter = /token|secret|password|passwd|credential|authorization|session|signature|csrf|xsrf|jwt|(?:^|[_-])(?:auth|key|sig|code)(?:$|[_-])|api[_-]?key|^x-amz-|^x-goog-/i;
  const safeURL = (value, allowFragment = false) => {
    if (!value) return '';
    const raw = String(value).trim();
    if (allowFragment && /^#[^\s]*$/.test(raw)) return raw;
    if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(raw)) return raw;
    try {
      const url = new URL(raw, document.baseURI);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      if (allowFragment && url.hash) {
        const page = new URL(document.URL || document.baseURI);
        if (url.origin === page.origin && url.pathname === page.pathname && url.search === page.search) return url.hash;
      }
      if (url.username || url.password) {
        url.username = '';
        url.password = '';
        warnings.add('资源地址中的凭据已移除，部分资源可能无法加载。');
      }
      for (const key of [...url.searchParams.keys()]) {
        if (sensitiveParameter.test(key)) {
          url.searchParams.delete(key);
          warnings.add('资源地址中的凭据已移除，部分资源可能无法加载。');
        }
      }
      // Fragments can carry authentication state; only local SVG references retain them.
      url.hash = '';
      warnings.add('部分图片或背景仍依赖原网站，离线或登录失效后可能无法显示。');
      return url.href;
    } catch { return ''; }
  };
  const decodeCSS = value => value.replace(/\\([0-9a-f]{1,6})(?:\r\n|[ \t\n\r\f])?|\\([^\r\n\f])/gi, (_, hex, character) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : character);
  const safeCSS = value => String(value).replace(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/gi, (_, doubleQuoted, singleQuoted, bare) => {
    const url = safeURL(decodeCSS(doubleQuoted ?? singleQuoted ?? bare).trim(), true);
    return url ? 'url("' + url.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, '') + '")' : 'none';
  }).replace(/</g, '\\3c ');
  const readStyle = (source, pseudo) => {
    const style = getComputedStyle(source, pseudo || null);
    const declarations = [];
    if (pseudo) {
      const content = style.getPropertyValue('content');
      if (!content || content === 'none' || content === 'normal' || style.getPropertyValue('display') === 'none') return '';
      const resolved = content.replace(/attr\(\s*([\w-]+)\s*\)/g, (_, name) => JSON.stringify(source.getAttribute(name) || ''));
      declarations.push('content:' + safeCSS(resolved));
    }
    for (const property of properties) {
      const value = style.getPropertyValue(property);
      if (value) declarations.push(property + ':' + safeCSS(value));
    }
    // Freeze motion so the design remains editable and repeatable.
    declarations.push('animation:none', 'transition:none', 'caret-color:transparent');
    return declarations.join(';');
  };
  const assignStyles = (source, target) => {
    const normal = readStyle(source);
    const before = readStyle(source, '::before');
    const after = readStyle(source, '::after');
    const key = normal + '\n' + before + '\n' + after;
    let name = classes.get(key);
    if (!name) {
      name = 'capture-' + classes.size;
      classes.set(key, name);
      const rule = '.' + name + '{' + normal + '}' + (before ? '.' + name + '::before{' + before + '}' : '') + (after ? '.' + name + '::after{' + after + '}' : '');
      account(rule.length);
      rules.push(rule);
    }
    target.setAttribute('class', name);
  };
  const setAttribute = (target, name, value) => {
    account(name.length + String(value).length + 8);
    target.setAttribute(name, value);
  };
  const rasterize = source => {
    try {
      if (source.localName === 'canvas') {
        if (source.width * source.height > 16777216) return '';
        return source.toDataURL('image/png');
      }
      const canvas = document.createElement('canvas');
      canvas.width = source.naturalWidth || source.width;
      canvas.height = source.naturalHeight || source.height;
      if (!canvas.width || !canvas.height || canvas.width * canvas.height > 16777216) return '';
      canvas.getContext('2d').drawImage(source, 0, 0);
      return canvas.toDataURL('image/png');
    } catch { return ''; }
  };
  const copy = (source, depth = 0) => {
    if (++nodes > MAX_NODES) throw new Error('网页节点过多，无法生成设计稿（上限 25000 个节点）。');
    if (Date.now() - startedAt > 10000) throw new Error('网页内容过于复杂，生成设计稿超时。');
    if (depth > 200) throw new Error('网页嵌套过深，无法生成设计稿。');
    if (source.nodeType === 3) {
      account(source.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').length);
      return document.createTextNode(source.textContent);
    }
    if (source.nodeType !== 1) return null;
    const tag = source.localName.toLowerCase();
    const svg = source.namespaceURI === SVG_NS;
    if (tag === 'iframe' || tag === 'frame') warnings.add('内嵌页面未复制，设计稿可能缺少这部分内容。');
    if (source.shadowRoot || tag.includes('-')) warnings.add('自定义组件或 Shadow DOM 内容可能无法完整复制。');
    if (tag === 'foreignobject') warnings.add('SVG 内嵌网页内容未复制。');
    if (discarded.has(tag) || (svg && !svgTags.has(tag))) return null;
    if (tag === 'input' && ['password', 'hidden', 'file'].includes((source.getAttribute('type') || '').toLowerCase())) {
      warnings.add('表单输入内容、密码与隐藏字段未复制。');
      return null;
    }
    if (source.namespaceURI && source.namespaceURI !== SVG_NS && source.namespaceURI !== HTML_NS) {
      warnings.add('部分特殊内容未复制。');
      return null;
    }
    // Unknown/custom HTML elements become inert containers; never construct a custom element.
    const targetTag = tag === 'canvas' ? 'img' : (svg || htmlTags.has(tag) ? source.localName : 'div');
    const target = svg ? document.createElementNS(SVG_NS, targetTag) : document.createElement(targetTag);
    account(targetTag.length * 2 + 40);
    for (const attribute of [...source.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'class') continue;
      if (commonAttributes.has(name) || (svg && svgAttributes.has(name))) {
        // Presentation attributes can also contain URLs (e.g. SVG fill/stroke).
        setAttribute(target, attribute.name, safeCSS(attribute.value));
      }
    }
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      warnings.add('表单输入内容、密码与隐藏字段未复制。');
      if (tag === 'input') {
        const type = (source.getAttribute('type') || 'text').toLowerCase();
        setAttribute(target, 'type', ['text', 'search', 'email', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'week', 'time', 'checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset'].includes(type) ? type : 'text');
        if (['button', 'submit', 'reset'].includes(type)) {
          setAttribute(target, 'type', 'button');
          setAttribute(target, 'value', source.getAttribute('value') || '');
        }
      }
    }
    if (tag === 'button') setAttribute(target, 'type', 'button');
    if (tag === 'img' || tag === 'canvas') {
      let url = tag === 'canvas' ? rasterize(source) : (source.currentSrc || source.getAttribute('src') || '');
      if (url.startsWith('blob:')) url = rasterize(source);
      url = safeURL(url);
      if (url) setAttribute(target, 'src', url);
      else if (tag === 'canvas' || source.getAttribute('src')) warnings.add('部分 Canvas 或图片无法复制，已保留其布局位置。');
      setAttribute(target, 'alt', source.getAttribute('alt') || '');
      setAttribute(target, 'referrerpolicy', 'no-referrer');
    }
    if (svg && ['use', 'image', 'feimage', 'textpath'].includes(tag)) {
      const original = source.getAttribute('href') || source.getAttribute('xlink:href');
      const url = safeURL(original, true);
      // External SVG references are omitted; only image elements can load a remote raster resource.
      if (url && (tag === 'image' || tag === 'feimage' || url.startsWith('#'))) setAttribute(target, 'href', url);
    }
    if (tag === 'video') {
      const poster = safeURL(source.getAttribute('poster'));
      if (poster) setAttribute(target, 'poster', poster);
      warnings.add('视频和音频仅保留静态外观。');
    }
    if (tag === 'svg') setAttribute(target, 'xmlns', SVG_NS);
    assignStyles(source, target);
    if (tag !== 'textarea' && tag !== 'canvas') {
      for (const child of [...source.childNodes]) {
        const childCopy = copy(child, depth + 1);
        if (childCopy) target.appendChild(childCopy);
      }
    }
    return target;
  };
  if (!document.body) throw new Error('网页尚未加载完成，请稍后重试。');
  const root = document.createElement('html');
  const lang = document.documentElement.getAttribute('lang');
  if (lang) setAttribute(root, 'lang', lang);
  assignStyles(document.documentElement, root);
  const head = document.createElement('head');
  const charset = document.createElement('meta');
  charset.setAttribute('charset', 'UTF-8');
  head.appendChild(charset);
  const viewport = document.createElement('meta');
  viewport.setAttribute('name', 'viewport');
  viewport.setAttribute('content', 'width=device-width, initial-scale=1');
  head.appendChild(viewport);
  // Serialize RCDATA explicitly: a page title must never be able to close its title element.
  const title = (document.title || '网页设计稿').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  try {
    const sourceURL = new URL(document.URL || document.baseURI);
    if (['http:', 'https:'].includes(sourceURL.protocol)) {
      sourceURL.username = '';
      sourceURL.password = '';
      sourceURL.search = '';
      sourceURL.hash = '';
      const sourceMeta = document.createElement('meta');
      sourceMeta.setAttribute('name', 'design-source');
      sourceMeta.setAttribute('content', sourceURL.href);
      head.appendChild(sourceMeta);
    }
  } catch {}
  const capturedAt = document.createElement('meta');
  capturedAt.setAttribute('name', 'design-captured-at');
  capturedAt.setAttribute('content', new Date().toISOString());
  head.appendChild(capturedAt);
  root.appendChild(head);
  root.appendChild(copy(document.body));
  const stylesheet = document.createElement('style');
  stylesheet.textContent = rules.join('\n');
  head.appendChild(stylesheet);
  if (document.fonts && document.fonts.size) warnings.add('网页字体未打包，本地显示可能与原页面不同。');
  const html = '<!DOCTYPE html>\n' + root.outerHTML.replace('<head>', () => '<head><title>' + title + '</title>');
  if (html.length > MAX_LENGTH) throw new Error('网页内容过大，无法生成设计稿（上限 12 MB）。');
  return { html, warnings: [...warnings], viewport: { width: window.innerWidth, height: window.innerHeight } };
})()`
