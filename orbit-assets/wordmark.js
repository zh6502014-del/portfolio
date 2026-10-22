// Fit the background "UI/UX" wordmark to the navigation's content width.
// Inlined as a classic script right after the orbit markup by build-preview.py,
// so it runs before first paint instead of after the Three.js module loads.
(function () {
function alignWordmark() {
  const wordmark=document.querySelector('.orbit-wordmark');
  const text=wordmark.querySelector('.orbit-wordmark-text');
  const nav=document.querySelector('.nav-inner');
  const context=document.createElement('canvas').getContext('2d');
  if(!context||!nav)return;
  function align() {
    const navBounds=nav.getBoundingClientRect();
    const navStyle=getComputedStyle(nav);
    const left=navBounds.left+parseFloat(navStyle.paddingLeft);
    const right=navBounds.right-parseFloat(navStyle.paddingRight);
    const width=right-left;
    if(width<=0)return;
    let style=getComputedStyle(text);
    const spacingRatio=(parseFloat(style.letterSpacing)||0)/parseFloat(style.fontSize);
    context.textAlign='left';
    // Fit the visible ink to the navigation's actual content gutters, including
    // its max-width and responsive padding. Keep the type uniformly scaled.
    context.font=`${style.fontWeight} 1000px ${style.fontFamily}`;
    const sample=context.measureText(text.textContent);
    const gaps=Array.from(text.textContent).length-1;
    const inkWidth=sample.actualBoundingBoxLeft+sample.actualBoundingBoxRight+1000*spacingRatio*gaps;
    wordmark.style.fontSize=`${1000*width/inkWidth}px`;
    style=getComputedStyle(text);
    context.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const spacing=parseFloat(style.letterSpacing)||0;
    const metrics=context.measureText(text.textContent);
    // U and X have different side bearings; center their ink, not the text box.
    const inkCenter=(metrics.actualBoundingBoxRight+spacing*gaps-metrics.actualBoundingBoxLeft)/2;
    const bounds=wordmark.getBoundingClientRect();
    const offset=text.getBoundingClientRect().width/2-inkCenter+(left+right-bounds.left-bounds.right)/2;
    text.style.setProperty('--wordmark-offset',`${offset}px`);
  }
  const observer=new ResizeObserver(align);
  observer.observe(wordmark);
  observer.observe(nav);
  // Keep the wordmark hidden until it is sized with the final web font, so a
  // reload never shows the oversized CSS fallback or the fallback-font metrics.
  const reveal=()=>{align();wordmark.classList.add('is-fitted');};
  // fonts.ready can resolve before layout has requested the 800 weight, so ask
  // for that exact face. A slow font network still reveals after 1.5 s.
  const face=getComputedStyle(text);
  Promise.race([
    document.fonts.load(`${face.fontWeight} 100px ${face.fontFamily}`,text.textContent),
    new Promise(resolve=>setTimeout(resolve,1500))
  ]).then(reveal,reveal);
  document.fonts.addEventListener('loadingdone',align);
  align();
}
alignWordmark();
})();
