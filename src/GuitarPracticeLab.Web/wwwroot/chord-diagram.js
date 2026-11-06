(function(){
'use strict';
  function svgNode(tag, attrs, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key,value]) => node.setAttribute(key,value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function diagram(shape, selectedName) {
    const svg = svgNode('svg', {viewBox:'0 0 250 250',role:'img','aria-label':selectedName + ', low E to high e: ' + shape.frets.map(f => f < 0 ? 'muted' : f === 0 ? 'open' : 'fret ' + f).join(', ')});
    const positive = shape.frets.filter(f => f > 0), start = Math.max(...positive) <= 4 ? 1 : Math.min(...positive);
    const x = i => 50 + i * 30, y = f => 58 + (f - start + .5) * 33;
    svg.append(svgNode('rect',{x:0,y:0,width:250,height:250,rx:10,fill:'#f7f4e9'}));
    svg.append(svgNode('text',{x:125,y:20,'text-anchor':'middle',fill:'#26344a','font-size':12},'Low E → high e · fingers 1–4'));
    for (let i=0;i<6;i++) {
      svg.append(svgNode('line',{x1:x(i),x2:x(i),y1:58,y2:190,stroke:'#283448','stroke-width':1.3}));
      if (shape.frets[i] <= 0) svg.append(svgNode('text',{x:x(i),y:47,'text-anchor':'middle',fill:'#172238','font-size':18},shape.frets[i] < 0 ? '×' : '○'));
      svg.append(svgNode('text',{x:x(i),y:211,'text-anchor':'middle',fill:'#26344a','font-size':13},['E','A','D','G','B','e'][i]));
    }
    for (let i=0;i<5;i++) svg.append(svgNode('line',{x1:50,x2:200,y1:58+i*33,y2:58+i*33,stroke:'#283448','stroke-width':i===0&&start===1?5:1.3}));
    svg.append(svgNode('text',{x:13,y:81,fill:'#26344a','font-size':13},start+'fr'));
    if (shape.barre) svg.append(svgNode('line',{x1:x(shape.barre.from),x2:x(shape.barre.to),y1:y(shape.barre.fret),y2:y(shape.barre.fret),stroke:'#1a5b9f','stroke-width':17,'stroke-linecap':'round'}));
    shape.frets.forEach((f,i) => {
      if (f <= 0) return;
      svg.append(svgNode('circle',{cx:x(i),cy:y(f),r:10,fill:'#1a5b9f'}));
      svg.append(svgNode('text',{x:x(i),y:y(f)+4,'text-anchor':'middle',fill:'white','font-size':12,'font-weight':700},String(shape.labels[i])));
    });
    svg.append(svgNode('text',{x:125,y:235,'text-anchor':'middle',fill:'#26344a','font-size':12},'× muted · ○ open · bar = barre'));
    return svg;
  }
window.GuitarChordDiagram=diagram;
})();
