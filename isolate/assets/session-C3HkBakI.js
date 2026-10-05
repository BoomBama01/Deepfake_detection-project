const e=new Map;function r(t,i){if(e.set(t,i),e.size>6){const n=e.keys().next().value;n&&e.delete(n)}}function s(t){return e.get(t)}export{s as a,r};
