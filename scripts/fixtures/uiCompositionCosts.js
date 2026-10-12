/** Paired diagnostics only; restores all UI before ordinary gameplay checks. */
export async function measureUiCompositionCosts() {
  const filters = [...document.querySelectorAll('body *')].flatMap(element => {
    const style = getComputedStyle(element),rect = element.getBoundingClientRect();
    if ((style.filter === 'none' && style.backdropFilter === 'none') || style.visibility === 'hidden'
      || !rect.width || !rect.height || rect.right <= 0 || rect.bottom <= 0
      || rect.left >= innerWidth || rect.top >= innerHeight) return [];
    return [{tag:element.tagName,id:element.id,class:element.getAttribute('class'),
      filter:style.filter,backdropFilter:style.backdropFilter,width:rect.width,height:rect.height}];
  }).sort((a,b)=>b.width*b.height-a.width*a.height);
  const override = document.createElement('style'); document.head.append(override);
  const arms = [];
  try {
    for (const [name,css] of [
      ['normal-before',''],
      ['css-filters-disabled','body * {filter:none!important;backdrop-filter:none!important;}'],
      ['ui-hidden','body * {visibility:hidden!important;} body canvas {visibility:visible!important;}'],
      ['normal-restored',''],
    ]) {
      override.textContent = css;
      for (let i=0;i<60;i++) await new Promise(requestAnimationFrame);
      const times = []; let previous = await new Promise(requestAnimationFrame);
      for (let i=0;i<120;i++) {
        const now = await new Promise(requestAnimationFrame); times.push(now-previous); previous = now;
      }
      times.sort((a,b)=>a-b);
      arms.push({name,meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times[Math.floor(times.length*.95)]});
    }
  } finally { override.remove(); }
  return {filters,domElements:document.querySelectorAll('body *').length,arms};
}
