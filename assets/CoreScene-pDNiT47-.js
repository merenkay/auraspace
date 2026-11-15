import{C as e,D as t,E as n,M as r,S as i,b as a,d as o,f as s,h as c,k as l,m as u,p as d,s as f,u as p,v as m}from"./three-CE6yQnrs.js";import{C as h,D as g,E as _,O as v,S as y,T as b,_ as x,a as S,b as C,c as w,d as T,f as E,g as D,h as O,i as k,k as A,l as j,m as M,n as ee,o as te,p as N,r as P,s as F,u as I,v as L,w as ne,x as R,y as z}from"./Aura-CRCSAeJb.js";var B=30,V=6.45,H=Math.tan(B*Math.PI/360),U=.12,W=120,G=`
uniform float uHalf;
uniform float uAmp;
uniform float uJit;
uniform float uTime;
uniform float uCam;
uniform float uScale;
uniform float uAspect;
attribute vec3 aDir;
attribute float aAlong;
varying float vZ;
varying float vAlong;
varying vec2 vP;
float wob(vec3 d) {
  return sin(dot(d, vec3(3.1, 4.7, 2.3)) + uTime * 1.7) * 0.6 + sin(dot(d, vec3(-5.3, 1.9, 6.1)) - uTime * 2.3) * 0.4;
}
void main() {
  vec3 c = position;
  if (uAmp + uJit > 0.0) c *= 1.0 + uAmp * (0.55 + 0.45 * wob(position)) + uJit * wob(position.zxy);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  vec3 d = mat3(modelViewMatrix) * aDir;
  mv.xyz += normalize(d) * (length(aDir) * uHalf);
  vZ = (mv.z + uCam) / uScale;
  vAlong = aAlong;
  gl_Position = projectionMatrix * mv;
  vP = gl_Position.xy / gl_Position.w * vec2(uAspect, 1.0);
}`,re=`
uniform vec3 uColor;
uniform float uOpacity;
uniform float uBack;
uniform float uDash;
uniform float uClip;
varying float vZ;
varying float vAlong;
varying vec2 vP;
void main() {
  if (uDash > 0.0 && fract(vAlong / uDash) > 0.5) discard;
  // a zoomed-in core fades out at the fixed tick ring instead of being cut by the edge of the canvas
  float window = 1.0 - smoothstep(uClip * 0.9, uClip, length(vP));
  gl_FragColor = vec4(uColor, uOpacity * window * mix(uBack, 1.0, smoothstep(-1.1, 0.0, vZ)));
  #include <colorspace_fragment>
}`,ie=`
uniform float uSize;
uniform float uAmp;
uniform float uJit;
uniform float uTime;
uniform float uCam;
uniform float uScale;
uniform float uAspect;
varying float vZ;
varying vec2 vP;
float wob(vec3 d) {
  return sin(dot(d, vec3(3.1, 4.7, 2.3)) + uTime * 1.7) * 0.6 + sin(dot(d, vec3(-5.3, 1.9, 6.1)) - uTime * 2.3) * 0.4;
}
void main() {
  vec3 c = position;
  if (uAmp + uJit > 0.0) c *= 1.0 + uAmp * (0.55 + 0.45 * wob(position)) + uJit * wob(position.zxy);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  vZ = (mv.z + uCam) / uScale;
  gl_PointSize = uSize * (0.8 + 0.4 * smoothstep(-1.0, 1.0, vZ));
  gl_Position = projectionMatrix * mv;
  vP = gl_Position.xy / gl_Position.w * vec2(uAspect, 1.0);
}`,ae=`
uniform vec3 uColor;
uniform float uOpacity;
uniform float uBack;
uniform float uClip;
varying float vZ;
varying vec2 vP;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.34, 0.5, d)) * (1.0 - smoothstep(uClip * 0.9, uClip, length(vP))) * uOpacity * mix(uBack, 1.0, smoothstep(-1.1, 0.0, vZ));
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`,oe=`
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`,se=`
uniform vec3 uColor;
uniform vec3 uBg;
uniform float uFill;
uniform float uRim;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = smoothstep(uRim - 0.04, uRim + 0.04, f);
  gl_FragColor = vec4(mix(mix(uBg, uColor, uFill), uColor, rim), 1.0);
  #include <colorspace_fragment>
}`,ce=`
uniform float uAspect;
attribute vec4 aColor;
varying vec4 vC;
varying vec2 vP;
void main() {
  vC = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vP = gl_Position.xy / gl_Position.w * vec2(uAspect, 1.0);
}`,le=`
uniform vec3 uColor;
uniform float uTint;
uniform float uOpacity;
uniform float uClip;
varying vec4 vC;
varying vec2 vP;
void main() {
  float a = vC.a * uOpacity * (1.0 - smoothstep(uClip * 0.9, uClip, length(vP)));
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(vC.rgb, uColor, uTint), a);
  #include <colorspace_fragment>
}`,ue=`
uniform float uSize;
uniform float uAmp;
uniform float uJit;
uniform float uTime;
uniform float uCam;
uniform float uScale;
uniform float uAspect;
attribute vec3 aColor;
attribute float aShape;
attribute float aBig;
varying float vZ;
varying vec2 vP;
varying vec3 vC;
varying float vShape;
float wob(vec3 d) {
  return sin(dot(d, vec3(3.1, 4.7, 2.3)) + uTime * 1.7) * 0.6 + sin(dot(d, vec3(-5.3, 1.9, 6.1)) - uTime * 2.3) * 0.4;
}
void main() {
  vec3 c = position;
  if (uAmp + uJit > 0.0) c *= 1.0 + uAmp * (0.55 + 0.45 * wob(position)) + uJit * wob(position.zxy);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  vZ = (mv.z + uCam) / uScale;
  vC = aColor;
  vShape = aShape;
  gl_PointSize = uSize * aBig * (0.85 + 0.3 * smoothstep(-1.0, 1.0, vZ));
  gl_Position = projectionMatrix * mv;
  vP = gl_Position.xy / gl_Position.w * vec2(uAspect, 1.0);
}`,de=`
uniform vec3 uBg;
uniform float uOpacity;
uniform float uClip;
varying float vZ;
varying vec2 vP;
varying vec3 vC;
varying float vShape;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = vShape > 0.5 && vShape < 1.5 ? (abs(q.x) + abs(q.y)) * 0.92 : vShape > 1.5 && vShape < 2.5 ? max(max(abs(q.x), abs(q.y)), (abs(q.x) + abs(q.y)) * 0.7071) * 1.06 : length(q);
  float body = 1.0 - smoothstep(0.42, 0.5, d);
  float hole = vShape > 0.5 ? 1.0 - smoothstep(vShape > 2.5 ? 0.3 : 0.24, vShape > 2.5 ? 0.38 : 0.32, d) : 0.0;
  float a = body * uOpacity * (1.0 - smoothstep(uClip * 0.9, uClip, length(vP))) * mix(0.3, 1.0, smoothstep(-0.9, 0.1, vZ));
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(vC, uBg, hole), a);
  #include <colorspace_fragment>
}`,K=class{pos=[];col=[];idx=[];arc(e,t,n,r,i,a){if(!(t>e))return;let o=Math.max(1,Math.ceil((t-e)/2.5)),s=this.pos.length/3;for(let s=0;s<=o;s++){let c=(e+(t-e)*s/o)*Math.PI/180,l=Math.sin(c),u=Math.cos(c);this.pos.push(l*n,u*n,0,l*r,u*r,0),this.col.push(i.r,i.g,i.b,a,i.r,i.g,i.b,a)}for(let e=0;e<o;e++){let t=s+e*2;this.idx.push(t,t+1,t+2,t+2,t+1,t+3)}}dots(e,t,n,r,i,a,o=1.3,s=2.1){for(let c=e;c<t-.01;c+=o+s)this.arc(c,Math.min(t,c+o),n,r,i,a)}ngon(e,t,n,r,i,a,o,s){let c=e*Math.PI/180,l=Math.sin(c)*t,u=Math.cos(c)*t,d=this.pos.length/3;for(let e=0;e<r;e++){let t=a+e/r*Math.PI*2;this.pos.push(l+Math.cos(t)*n*i,u+Math.sin(t)*n*i,0,l+Math.cos(t)*n,u+Math.sin(t)*n,0),this.col.push(o.r,o.g,o.b,s,o.r,o.g,o.b,s)}for(let e=0;e<r;e++){let t=d+e*2,n=d+(e+1)%r*2;this.idx.push(t,t+1,n,n,t+1,n+1)}}geometry(){let e=new o;return e.setAttribute(`position`,new p(new Float32Array(this.pos),3)),e.setAttribute(`aColor`,new p(new Float32Array(this.col),4)),e.setIndex(new p(this.pos.length/3>65535?new Uint32Array(this.idx):new Uint16Array(this.idx),1)),e}};function fe(){return new t({vertexShader:ce,fragmentShader:le,uniforms:{uColor:{value:new s},uTint:{value:0},uOpacity:{value:1},uAspect:{value:1},uClip:{value:10}},transparent:!0,depthWrite:!1,depthTest:!1,side:2})}function q(e,t){let n=0,r=0;for(let i of e)n+=i.frames.length*t,r+=(i.closed?i.frames.length:i.frames.length-1)*t;let i=new Float32Array(n*3),a=new Float32Array(n*3),s=new Float32Array(n),c=n>65535?new Uint32Array(r*6):new Uint16Array(r*6),l=0,u=0;for(let n of e){let e=l,r=n.frames.length;for(let e of n.frames)for(let n=0;n<t;n++){let r=n/t*Math.PI*2,o=Math.cos(r),c=Math.sin(r);i[l*3]=e.p.x,i[l*3+1]=e.p.y,i[l*3+2]=e.p.z,a[l*3]=e.n.x*o+e.b.x*c,a[l*3+1]=e.n.y*o+e.b.y*c,a[l*3+2]=e.n.z*o+e.b.z*c,s[l]=e.along,l++}let o=n.closed?r:r-1;for(let n=0;n<o;n++){let i=e+n*t,a=e+(n+1)%r*t;for(let e=0;e<t;e++){let n=(e+1)%t;c[u++]=i+e,c[u++]=a+e,c[u++]=i+n,c[u++]=i+n,c[u++]=a+e,c[u++]=a+n}}}let d=new o;return d.setAttribute(`position`,new p(i,3)),d.setAttribute(`aDir`,new p(a,3)),d.setAttribute(`aAlong`,new p(s,1)),d.setIndex(new p(c,1)),d}var J=new r(0,0,1);function Y(e,t,n,i){let a=[],o=i?n:n+1;for(let i=0;i<o;i++){let o=e+(t-e)*i/n,s=new r(Math.cos(o),Math.sin(o),0);a.push({p:s,n:s.clone(),b:J,along:Math.abs(o-e)})}return{frames:a,closed:i}}function pe(e){let t=1/Math.cos(Math.PI/e),n=0,i=2*Math.sin(Math.PI/e);return{frames:v(e,1).map(([e,a])=>{let o=new r(e,a,0),s={p:o,n:o.clone().multiplyScalar(t),b:J,along:n};return n+=i,s}),closed:!0}}function X(e,t,n,i,a){let o=[];for(let s=0;s<e;s++){let c=s/e*Math.PI*2+Math.PI/2,l=new r(Math.cos(c),Math.sin(c),0),u=new r(-Math.sin(c),Math.cos(c),0),d=s%a===0?i:n;o.push({frames:[{p:l.clone().multiplyScalar(t),n:u,b:J,along:0},{p:l.clone().multiplyScalar(t+d),n:u,b:J,along:d}],closed:!1})}return o}function Z(e){return new t({vertexShader:G,fragmentShader:re,uniforms:{uColor:{value:new s},uOpacity:{value:1},uBack:{value:e},uDash:{value:0},uHalf:{value:.01},uAmp:{value:0},uJit:{value:0},uTime:{value:0},uCam:{value:V},uScale:{value:1},uAspect:{value:1},uClip:{value:10}},transparent:!0,depthWrite:!1})}function Q(){return new t({vertexShader:oe,fragmentShader:se,uniforms:{uColor:{value:new s},uBg:{value:new s},uFill:{value:.14},uRim:{value:.7}}})}function $(e){if(typeof requestIdleCallback==`function`){let t=requestIdleCallback(e,{timeout:400});return()=>cancelIdleCallback(t)}let t=setTimeout(e,0);return()=>clearTimeout(t)}var me=e=>e>0?e<1?e:1:0,he=class{o;renderer;scene=new n;camera=new a(B,1,.5,40);object=new c;frame=new c;inner=new c;shell=new c;shellMesh;vitalsMesh;bars;gate;nodes;nodeIndex=[];latticeVerts=[];data;selected=null;hots=[];anchors=[];full;depth=0;targetDepth=0;snapAt=0;layerIndex=0;hist=new Float32Array(O.bars.count);histClock=0;histLive=!1;tmpV=new r;rings=[];ticks;ticksCompact;octagon;arc;edges;points;nucleus;dot;lineMats=[];disposables=[];state;live;reduced;lowPower;palette;width;height;pixelRatio=1;compact=!1;view={...P};target={...P};level=0;level1=0;level2=0;time=0;sinceChange=0;sinceUrgent=0;interactUntil=0;snap=!0;shellRadius;shellJit=0;edgeOpacity=0;pointOpacity=0;pointSize=2.6;nucleusRadius;dotRadius;fill;octagonOpacity=0;arcOpacity=0;moving=!0;raf=0;lastDraw=0;frames=0;built=!1;ready=!1;cancelStart=()=>void 0;paused=!1;disposed=!1;tmpQ=new e;tmpQ2=new e;tmpE=new u;constructor(e){this.o=e,this.state=e.state,this.live=e.live,this.reduced=e.reduced,this.lowPower=e.lowPower,this.width=e.width,this.height=e.height,this.data=e.data??M,this.full=!!e.full,this.palette={accent:new s,edge:new s,dim:new s,soft:new s,ink:new s,crit:new s,bg:new s,warn:new s};let t=S[this.state];this.shellRadius=t.shell.radius,this.nucleusRadius=t.nucleus.radius,this.dotRadius=t.nucleus.dot,this.fill=t.nucleus.fill,this.renderer=new f({canvas:e.canvas,alpha:!0,antialias:!0,stencil:!1,powerPreference:`default`}),this.renderer.setClearColor(0,0),this.renderer.debug.checkShaderErrors=!1,e.canvas.addEventListener(`webglcontextlost`,this.onLost),this.cancelStart=$(()=>this.build())}build(){if(this.disposed)return;let n=this.o,a=S[this.state],c=(e,t,n)=>{let r=Z(t);this.lineMats.push(r),this.disposables.push(e,r);let i=new m(e,r);return i.frustumCulled=!1,i.renderOrder=n,i};this.ticks=c(q(X(72,F,.045,.09,9),4),1,3),this.ticksCompact=c(q(X(24,F-.04,.1,.1,1),4),1,3),this.frame.add(this.ticks,this.ticksCompact),this.scene.add(this.frame);let u=q([Y(0,Math.PI*2,144,!0)],5);this.disposables.push(u);for(let t=0;t<3;t++){let n=Z(.38);this.lineMats.push(n),this.disposables.push(n);let r=new m(u,n);r.frustumCulled=!1,r.renderOrder=3,this.rings.push({mesh:r,q:new e,radius:a.rings[t].radius,opacity:a.rings[t].opacity,angle:0}),this.inner.add(r)}this.gate=c(u,1,4),this.gate.visible=!1,this.frame.add(this.gate),this.arc=c(q([Y(Math.PI/2,0,40,!1)],5),1,4),this.rings[2].mesh.add(this.arc),this.octagon=c(q([pe(8)],5),1,4),this.inner.add(this.octagon);let f=g(3),h=f.edges.map(([e,t])=>{let n=new r(...f.vertices[e]),i=new r(...f.vertices[t]),a=i.clone().sub(n).normalize(),o=a.clone().cross(n.clone().add(i)).normalize(),s=a.clone().cross(o).normalize();return{frames:[{p:n,n:o,b:s,along:0},{p:i,n:o,b:s,along:1}],closed:!1}});this.edges=c(q(h,3),.22,3);let _=new o;_.setAttribute(`position`,new p(new Float32Array(f.vertices.flat()),3));let v=new t({vertexShader:ie,fragmentShader:ae,uniforms:{uColor:{value:new s},uOpacity:{value:1},uBack:{value:.35},uSize:{value:4},uAmp:{value:0},uJit:{value:0},uTime:{value:0},uCam:{value:V},uScale:{value:1},uAspect:{value:1},uClip:{value:10}},transparent:!0,depthWrite:!1});this.disposables.push(_,v),this.points=new i(_,v),this.points.frustumCulled=!1,this.points.renderOrder=3,this.latticeVerts=f.vertices,this.nodeIndex=A(f.vertices,12);let y=new o;y.setAttribute(`position`,new p(new Float32Array(this.nodeIndex.length*3),3)),y.setAttribute(`aColor`,new p(new Float32Array(this.nodeIndex.length*3),3)),y.setAttribute(`aShape`,new p(new Float32Array(this.nodeIndex.length),1)),y.setAttribute(`aBig`,new p(new Float32Array(this.nodeIndex.length),1));let b=new t({vertexShader:ue,fragmentShader:de,uniforms:{uBg:{value:new s},uOpacity:{value:1},uSize:{value:10},uAmp:{value:0},uJit:{value:0},uTime:{value:0},uCam:{value:V},uScale:{value:1},uAspect:{value:1},uClip:{value:10}},transparent:!0,depthWrite:!1,depthTest:!1});this.disposables.push(y,b),this.nodes=new i(y,b),this.nodes.frustumCulled=!1,this.nodes.renderOrder=5,this.shell.add(this.edges,this.points,this.nodes),this.inner.add(this.shell);let x=e=>{let t=fe();this.disposables.push(t);let n=new m(new o,t);return n.frustumCulled=!1,n.renderOrder=e,n};this.shellMesh=x(2),this.vitalsMesh=x(2);let C=new K;for(let e=0;e<O.bars.count;e++)C.arc(e*5+1.2,e*5+3.8,O.bars.r,O.bars.r+O.bars.rest,this.palette.ink,1);let w=C.geometry();w.getAttribute(`position`).setUsage(d),this.disposables.push(w),this.bars=x(2),this.bars.geometry.dispose(),this.bars.geometry=w,this.bars.material.uniforms.uTint.value=1,this.object.add(this.shellMesh,this.vitalsMesh,this.bars);let T=new l(1,40,24),E=Q(),D=Q();D.depthTest=!1,D.uniforms.uFill.value=1,D.uniforms.uRim.value=2,this.disposables.push(T,E,D),this.nucleus=new m(T,E),this.nucleus.renderOrder=1,this.dot=new m(T,D),this.dot.renderOrder=2,this.inner.add(this.nucleus,this.dot),this.object.add(this.inner),this.scene.add(this.object),this.built=!0,this.setPalette(n.palette),this.rebuildData(),this.resize(this.width,this.height),this.update(0);let k=()=>{this.disposed||(this.renderer.render(this.scene,this.camera),this.frames++,this.ready=!0,this.o.onFrame?.(),this.lastDraw=performance.now(),this.o.onReady(),this.wake())};this.cancelStart=$(()=>{if(!this.disposed)try{this.renderer.compileAsync(this.scene,this.camera).then(k,k)}catch{k()}})}onLost=e=>{e.preventDefault(),this.disposed||(this.pause(!0),this.o.onLost())};setState(e,t){(e!==this.state||t!==this.live)&&(e!==this.state&&(this.sinceChange=0,e!==`idle`&&(this.target=I(this.view)),e===`urgent`&&(this.sinceUrgent=0,this.snap=!0),this.state=e,this.applyColors()),this.live=t,this.wake())}setPalette(e){for(let t of Object.keys(this.palette))try{this.palette[t].set(e[t])}catch{}this.applyColors(),this.rebuildData(),this.wake()}setData(e){e!==this.data&&(this.data=e,this.rebuildData(),this.wake())}setSelected(e){e!==this.selected&&(this.selected=e,this.rebuildData(),this.wake())}setFull(e){e!==this.full&&(this.full=e,this.resize(this.width,this.height))}statusColor(e,t){return e===`crit`?this.palette.crit:e===`warn`?this.palette.warn:e===`none`?this.palette.edge:t}rebuildData(){if(!this.built)return;let e=this.data,t=this.palette,n=this.selected,i=e=>n&&n!==e?.42:1,a=[],o=(e,t,n,i,o,s)=>{let c=[];for(let e=0;e<=6;e++){let t=(n+(i-n)*e/6)*Math.PI/180;c.push(new r(Math.sin(t)*o,Math.cos(t)*o,0))}let l=(n+i)/2*Math.PI/180;a.push({item:e,layer:t,inShell:!1,anchor:new r(Math.sin(l)*s,Math.cos(l)*s,0),pts:c})},s=new K,c=O.dial,l=360/c.segments,u=e.missionFraction==null?0:Math.round(e.missionFraction*c.segments);for(let e=0;e<c.segments;e++){let n=e<u;s.arc(e*l+c.gap/2,(e+1)*l-c.gap/2,c.r0,c.r1,n?t.soft:t.edge,(n?.95:.38)*i(`mission`))}e.mission&&o(e.mission,0,O.missionAt-14,O.missionAt+14,(c.r0+c.r1)/2,c.r1),e.cabin.length?s.arc(0,360,O.rail-.004,O.rail+.004,t.edge,.5):s.dots(0,360,O.rail-.005,O.rail+.005,t.edge,.7,.9,2.1),z(e.cabin).forEach((n,r)=>{let a=e.cabin[r],c=i(a.id);s.arc(n.from,n.to,O.rail-.02,O.rail+.02,t.edge,.55*c),a.fraction!=null&&s.arc(n.from,n.from+(n.to-n.from)*Math.max(.03,a.fraction),O.rail-.02,O.rail+.02,this.statusColor(a.status,t.ink),c),s.arc(n.from-.5,n.from,O.rail-.04,O.rail+.04,t.dim,c),s.arc(n.to,n.to+.5,O.rail-.04,O.rail+.04,t.dim,c),o(a,0,n.from,n.to,O.rail,O.rail+.02)}),this.shellMesh.geometry.dispose(),this.shellMesh.geometry=s.geometry();let d=new K,f=O.vitals,p=b(e.vitals);p.length||d.dots(0,360,f.track-.005,f.track+.005,t.edge,.7,.9,2.1),p.forEach((r,a)=>{let s=e.vitals[a],c=i(s.id);if(s.status===`none`)d.dots(r.from,r.to,f.r0+.012,f.r1-.012,t.edge,.85*c);else{d.arc(r.from,r.to,f.track-.004,f.track+.004,t.edge,.6*c);let e=s.fraction==null?r.to:r.from+(r.to-r.from)*Math.max(.04,s.fraction);d.arc(r.from,e,f.r0,f.r1,this.statusColor(s.status,t.soft),c),s.status===`warn`&&d.ngon(r.mid,f.marker,.034,4,.5,0,t.warn,c),s.status===`crit`&&d.ngon(r.mid,f.marker,.036,8,.56,Math.PI/8,t.crit,c)}n===s.id&&(d.arc(r.from-.9,r.from-.3,f.r0-.035,f.r1+.035,t.ink,1),d.arc(r.to+.3,r.to+.9,f.r0-.035,f.r1+.035,t.ink,1)),o(s,1,r.from,r.to,(f.r0+f.r1)/2,f.r1)}),this.vitalsMesh.geometry.dispose(),this.vitalsMesh.geometry=d.geometry();let m=this.nodes.geometry,h=m.getAttribute(`position`),g=m.getAttribute(`aColor`),_=m.getAttribute(`aShape`),v=m.getAttribute(`aBig`),y=Math.min(e.systems.length,this.nodeIndex.length);for(let i=0;i<this.nodeIndex.length;i++){let o=this.latticeVerts[this.nodeIndex[i]];if(h.setXYZ(i,o[0],o[1],o[2]),i>=y){v.setX(i,0);continue}let s=e.systems[i],c=this.statusColor(s.status,t.ink);g.setXYZ(i,c.r,c.g,c.b),_.setX(i,s.status===`warn`?1:s.status===`crit`?2:s.status===`none`?3:0),v.setX(i,(s.status===`ok`?.8:1.15)*(n===s.id?1.5:1)*(n&&n!==s.id?.8:1));let l=new r(o[0],o[1],o[2]);a.push({item:s,layer:2,inShell:!0,anchor:l,pts:[l]})}h.needsUpdate=!0,g.needsUpdate=!0,_.needsUpdate=!0,v.needsUpdate=!0,this.nodes.geometry.setDrawRange(0,y),this.hots=a}setReduced(e){e!==this.reduced&&(this.reduced=e,this.snap=!0,this.wake())}setLowPower(e){e!==this.lowPower&&(this.lowPower=e,this.resize(this.width,this.height))}resize(e,t){this.width=Math.max(1,e),this.height=Math.max(1,t);let n=typeof window>`u`?1:window.devicePixelRatio||1,r=this.full?Math.sqrt(25e5/(this.width*this.height)):2;this.pixelRatio=Math.max(.75,Math.min(n,this.lowPower?1.25:2,r)),this.renderer.setPixelRatio(this.pixelRatio),this.renderer.setSize(this.width,this.height,!1),this.camera.aspect=this.width/this.height,this.camera.updateProjectionMatrix(),this.compact=Math.min(this.width,this.height)<W,this.built&&(this.ticks.visible=!this.compact,this.ticksCompact.visible=this.compact,this.wake())}pause(e){e!==this.paused&&(this.paused=e,e?(cancelAnimationFrame(this.raf),this.raf=0):this.wake())}rotateBy(e,t){this.view=T(this.view,e,t),this.target={...this.target,yaw:this.view.yaw,pitch:this.view.pitch},this.touch()}zoomBy(e,t=!1){this.compact||(this.targetDepth=R(this.targetDepth,e),t||(this.depth=this.targetDepth),this.snapAt=performance.now()+380,this.touch())}diveTo(e){this.compact||(this.targetDepth=C(Math.round(e)),this.snapAt=0,this.touch())}diveBy(e){let t=y(this.targetDepth),n=C(t+(e>0?1:-1));return n!==t&&(this.diveTo(n),!0)}layer(){return y(this.targetDepth)}reset(){this.target=I(this.view),this.targetDepth=0,this.snapAt=0,this.touch()}worldOf(e,t,n){return n.copy(t).applyMatrix4((e.inShell?this.shell:this.object).matrixWorld)}pick(e,t,n=22){if(!this.ready||this.compact)return null;let r=y(this.targetDepth),i=null,a=n;for(let n of this.hots)if(!(n.layer<r))for(let o of n.pts){let s=this.worldOf(n,o,this.tmpV);if(n.inShell&&s.z<-.02)continue;s.project(this.camera);let c=(s.x*.5+.5)*this.width-e,l=(.5-s.y*.5)*this.height-t,u=Math.hypot(c,l)*(n.layer===r?.8:1);u<a&&(a=u,i=n.item)}return i}layout(){let e=y(this.targetDepth),t=0;for(let n of this.hots){if(n.layer!==e)continue;let r=this.worldOf(n,n.anchor,this.tmpV),i=!n.inShell||r.z>.04*this.shellRadius;r.project(this.camera);let a=this.anchors[t]??(this.anchors[t]={id:``,x:0,y:0,front:!0});a.id=n.item.id,a.x=(r.x*.5+.5)*this.width,a.y=(.5-r.y*.5)*this.height,a.front=i,t++}return this.anchors.length=t,this.anchors}touch(){this.interactUntil=performance.now()+160,this.wake()}stats(){return{ready:this.ready,running:this.raf!==0,paused:this.paused,frames:this.frames,rate:this.rate(),state:this.state,level:this.level,view:{...this.view},pixelRatio:this.pixelRatio,depth:this.depth,layer:y(this.targetDepth),calls:this.renderer.info.render.calls}}rate(){return j({state:this.state,live:this.live,reduced:this.reduced,lowPower:this.lowPower,moving:this.moving,level:this.level})}wake(){this.raf||this.paused||this.disposed||!this.ready||(this.moving=!0,this.raf=requestAnimationFrame(this.tick))}tick=e=>{if(this.raf=0,this.disposed||this.paused)return;let t=this.rate(),n=e-this.lastDraw;if(t!==30||n>=1e3/30-3){let t=n>250?1/60:Math.max(0,n/1e3);this.lastDraw=e,this.update(t),this.renderer.render(this.scene,this.camera),this.frames++,this.o.onFrame?.()}this.rate()>0&&(this.raf=requestAnimationFrame(this.tick))};applyColors(){if(!this.built)return;let e=S[this.state],t=this.palette;e.rings.forEach((e,n)=>this.rings[n].mesh.material.uniforms.uColor.value.copy(t[e.tone])),this.ticks.material.uniforms.uColor.value.copy(t.edge),this.ticksCompact.material.uniforms.uColor.value.copy(t.edge),this.octagon.material.uniforms.uColor.value.copy(t.crit),this.arc.material.uniforms.uColor.value.copy(t.accent),this.gate.material.uniforms.uColor.value.copy(t.accent),this.bars.material.uniforms.uColor.value.copy(this.state===`off`?t.edge:t[e.nucleus.tone]),this.nodes.material.uniforms.uBg.value.copy(t.bg),this.edges.material.uniforms.uColor.value.copy(t.dim),this.points.material.uniforms.uColor.value.copy(t[e.shell.tone]);for(let n of[this.nucleus.material,this.dot.material])n.uniforms.uColor.value.copy(t[e.nucleus.tone]),n.uniforms.uBg.value.copy(t.bg)}ringTarget(e,t,n){let r=this.tmpE,i=this.tmpQ2;return e.motion===`gimbalY`?n.setFromEuler(r.set(0,e.tilt+t,0)):n.setFromEuler(r.set(e.tilt+(e.motion===`gimbalX`?t:0),0,0)),n.premultiply(i.setFromEuler(r.set(0,0,e.roll))),e.motion===`precess`&&n.premultiply(i.setFromEuler(r.set(0,t,0))),n}update(e){let t=S[this.state],n=this.reduced,r=this.snap||n;this.snap=!1;let i=r?1:1-Math.exp(-e/te);this.sinceChange+=e,this.state===`urgent`&&(this.sinceUrgent+=e),n||(this.time+=e);let a=this.live&&!n?me(this.o.level()):0;this.level=r&&n?0:w(this.level,a,e,.06,.3),this.level1=w(this.level1,this.level,e,.08),this.level2=w(this.level2,this.level1,e,.08),this.level<.001&&(this.level=0);let o=this.state===`urgent`&&!n?E(this.sinceUrgent):0;if(n||N(this.view,this.target))this.view={...this.target};else{let t=1-Math.exp(-e/U);this.view={yaw:this.view.yaw+(this.target.yaw-this.view.yaw)*t,pitch:this.view.pitch+(this.target.pitch-this.view.pitch)*t,zoom:this.view.zoom+(this.target.zoom-this.view.zoom)*t}}this.object.quaternion.setFromEuler(this.tmpE.set(this.view.pitch,this.view.yaw,0));let s=this.width/this.height,c=performance.now();this.compact&&(this.targetDepth=0),this.snapAt&&(c>=this.snapAt||n)&&(this.targetDepth=y(this.targetDepth),this.snapAt=0),n||Math.abs(this.targetDepth-this.depth)<.003?this.depth=this.targetDepth:this.depth+=(this.targetDepth-this.depth)*(1-Math.exp(-e/.17));let l=y(this.targetDepth);l!==this.layerIndex&&(this.layerIndex=l,this.o.onLayer?.(l));let u=_(this.depth)*this.view.zoom,d=this.compact?1:D,f=V*(s<1?1/s:1)*(this.full?1.12:1);this.object.scale.setScalar(u),this.frame.scale.setScalar(u),this.inner.scale.setScalar(d),this.camera.position.z=f;let p=2*f*H/this.height,m=this.compact?1.15:1,g=[this.level1,this.level,this.level2];this.rings.forEach((a,o)=>{let s=t.rings[o];n?a.angle=0:s.motion!==`still`&&(a.angle+=s.rate*e),this.ringTarget(s,a.angle,this.tmpQ),r?a.q.copy(this.tmpQ):a.q.slerp(this.tmpQ,i),a.radius+=(s.radius-a.radius)*i,a.opacity+=(s.opacity-a.opacity)*i,a.mesh.quaternion.copy(a.q),a.mesh.scale.setScalar(a.radius*(1+s.react*g[o]));let c=a.mesh.material.uniforms;c.uOpacity.value=a.opacity*h(a.radius*d,u),c.uHalf.value=s.width*m*.5*p,c.uDash.value=s.dashed?this.compact?.3:.11:0,a.mesh.visible=c.uOpacity.value>.004}),this.arcOpacity+=(t.arc-this.arcOpacity)*i,n?this.arc.rotation.z=0:t.arc>0&&(this.arc.rotation.z-=Math.PI*2/ee*e),this.arc.material.uniforms.uOpacity.value=this.arcOpacity,this.arc.material.uniforms.uHalf.value=1.5*m*p,this.arc.visible=this.arcOpacity>.004,this.octagonOpacity+=(t.octagon-this.octagonOpacity)*i,this.octagon.scale.setScalar(k*(1+.045*o)),this.octagon.material.uniforms.uOpacity.value=this.octagonOpacity,this.octagon.material.uniforms.uHalf.value=1.25*m*p,this.octagon.visible=this.octagonOpacity>.004;let v=h(x[0].radius,u);for(let e of[this.ticks,this.ticksCompact])e.material.uniforms.uOpacity.value=(this.state===`off`?.6:.95)*v,e.material.uniforms.uHalf.value=.5*p;this.shellMesh.visible=!this.compact&&v>.004,this.shellMesh.material.uniforms.uOpacity.value=v;let b=h(x[1].radius,u);this.vitalsMesh.visible=!this.compact&&b>.004,this.vitalsMesh.material.uniforms.uOpacity.value=b;let C=n?0:ne(this.depth);if(this.gate.visible=C>.02,this.gate.visible&&(this.gate.scale.setScalar(x[Math.min(L,Math.floor(this.depth))].radius*1.04),this.gate.material.uniforms.uOpacity.value=C*.9,this.gate.material.uniforms.uHalf.value=1*p),this.histClock+=e,this.histClock>=1/24){this.histClock=0;let e=this.hist,t=this.live?this.level:0;if(this.histLive=t>.004,!this.histLive)for(let t=0;t<e.length;t++)e[t]>.004&&(this.histLive=!0);if(this.histLive){e.copyWithin(1,0,e.length-1),e[0]=t;let n=this.bars.geometry.getAttribute(`position`),r=n.array;for(let t=0;t<e.length;t++){let n=O.bars.r+O.bars.rest+O.bars.max*e[t];for(let e=0;e<3;e++){let i=(t*6+e*2+1)*3,a=(t*5+1.2+1.3*e)*Math.PI/180;r[i]=Math.sin(a)*n,r[i+1]=Math.cos(a)*n}}n.needsUpdate=!0}}this.bars.visible=!this.compact,this.bars.material.uniforms.uOpacity.value=this.state===`off`?.5:.9;let T=t.shell;this.shellRadius+=(T.radius-this.shellRadius)*i,this.shellJit+=((n?0:T.jitter)-this.shellJit)*i,this.edgeOpacity+=((this.compact?0:T.edges)-this.edgeOpacity)*i,this.pointOpacity+=((this.compact?0:T.points)-this.pointOpacity)*i,this.pointSize+=(T.size-this.pointSize)*i,this.shell.scale.setScalar(this.shellRadius),n?this.shell.rotation.set(.35,.5,0):this.shell.rotation.y+=T.drift*e;let A=T.react*this.level;for(let e of[this.edges.material,this.points.material])e.uniforms.uAmp.value=A,e.uniforms.uJit.value=this.shellJit,e.uniforms.uTime.value=this.time;this.edges.material.uniforms.uOpacity.value=this.edgeOpacity,this.edges.material.uniforms.uHalf.value=.5*p,this.points.material.uniforms.uOpacity.value=this.pointOpacity,this.points.material.uniforms.uSize.value=this.pointSize*(1+(T.react>.1?.6*this.level:0))*this.pixelRatio;let j=h(this.shellRadius*d,u);this.edges.material.uniforms.uOpacity.value*=j,this.points.material.uniforms.uOpacity.value*=j;let M=this.nodes.material.uniforms;M.uAmp.value=A,M.uJit.value=this.shellJit,M.uTime.value=this.time,M.uOpacity.value=this.compact?0:j,M.uSize.value=Math.min(26,9*Math.sqrt(u)*(this.height>420?1.25:1))*this.pixelRatio,this.nodes.visible=!this.compact&&j>.004,this.shell.visible=this.pointOpacity>.004||this.edgeOpacity>.004||this.nodes.visible;let P=t.nucleus;this.nucleusRadius+=(P.radius-this.nucleusRadius)*i,this.dotRadius+=(P.dot-this.dotRadius)*i,this.fill+=(P.fill-this.fill)*i;let F=n?0:P.breathe*Math.sin(this.time*Math.PI*2/6),I=this.compact?1.35:1,R=this.nucleusRadius*I*(1+F+P.react*this.level+.05*o);this.nucleus.scale.setScalar(R),this.dot.scale.setScalar(Math.max(1e-4,this.dotRadius*I*(1+F+P.react*1.2*this.level+.08*o))),this.dot.visible=this.dotRadius>.004,this.nucleus.material.uniforms.uFill.value=this.fill;let z=1-Math.min(.9,1.5*m/Math.max(4,R*d*u/p));this.nucleus.material.uniforms.uRim.value=1-Math.sqrt(1-z*z);let B=(this.full?6:this.compact?10:1.75)/(f*H);for(let e of[...this.lineMats,this.points.material,this.nodes.material])e.uniforms.uCam.value=f,e.uniforms.uScale.value=u*d,e.uniforms.uAspect.value=s,e.uniforms.uClip.value=B;for(let e of[this.shellMesh.material,this.vitalsMesh.material,this.bars.material])e.uniforms.uAspect.value=s,e.uniforms.uClip.value=B;this.moving=!n&&(Math.abs(this.targetDepth-this.depth)>=.003||this.snapAt>0||this.histLive&&!this.live||this.sinceChange<.7||!N(this.view,this.target)||this.state===`urgent`&&this.sinceUrgent<3.1||performance.now()<this.interactUntil||this.level>.02&&!this.live)}dispose(){if(!this.disposed){this.disposed=!0,this.cancelStart(),cancelAnimationFrame(this.raf),this.raf=0,this.o.canvas.removeEventListener(`webglcontextlost`,this.onLost);for(let e of this.disposables)e.dispose();this.shellMesh?.geometry.dispose(),this.vitalsMesh?.geometry.dispose(),this.renderer.dispose(),this.renderer.forceContextLoss()}}};export{he as CoreScene};