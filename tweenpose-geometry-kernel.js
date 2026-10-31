/* TweenPose's indexed, welded mesh operations. Requires THREE r128 or newer. */
(function (root, factory) {
  'use strict';
  var api = factory(function () {
    if (!root.THREE) throw new Error('THREE must be loaded before editing geometry.');
    return root.THREE;
  });
  root.TweenGeometry = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (three) {
  'use strict';
  var MAX_VERTICES = 60000, MAX_FACES = 160000, TOLERANCE = 1e-5;

  function number(value, fallback, min, max, label) {
    var n = value === undefined || value === null || value === '' ? fallback : Number(value);
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new Error((label || 'Value') + ' must be between ' + min + ' and ' + max + '.');
    }
    return n;
  }
  function integer(value, fallback, min, max, label) {
    var n = number(value, fallback, min, max, label);
    if (Math.floor(n) !== n) throw new Error((label || 'Value') + ' must be a whole number.');
    return n;
  }
  function budget(vertices, faces) {
    if (vertices > MAX_VERTICES || faces > MAX_FACES) {
      throw new Error('Geometry limit reached: use fewer segments, copies, or subdivisions (60,000 vertices maximum).');
    }
  }
  function key(a, b) { return a < b ? a + ':' + b : b + ':' + a; }
  function groupsFor(geometry, faceCount) {
    if (!geometry.groups || !geometry.groups.length) return null;
    var result = new Array(faceCount).fill(0);
    geometry.groups.forEach(function (group) {
      var start = Math.max(0, Math.ceil(group.start / 3));
      var end = Math.min(faceCount, Math.floor((group.start + group.count) / 3));
      var material = integer(group.materialIndex, 0, 0, 10000, 'Material index');
      for (var f = start; f < end; f++) result[f] = material;
    });
    return result;
  }
  function finish(positions, indices, uv, materials, colors) {
    budget(positions.length / 3, indices.length / 3);
    var T = three(), geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    if (uv) geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    if (colors) geometry.setAttribute('color', new T.Float32BufferAttribute(colors.values, colors.itemSize));
    if (materials && materials.length) {
      var start = 0, material = materials[0];
      for (var f = 1; f <= materials.length; f++) {
        if (f === materials.length || materials[f] !== material) {
          geometry.addGroup(start * 3, (f - start) * 3, material);
          start = f; material = materials[f];
        }
      }
    }
    geometry.computeVertexNormals();
    if (positions.length) {
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    } else {
      geometry.boundingBox = new T.Box3(new T.Vector3(), new T.Vector3());
      geometry.boundingSphere = new T.Sphere(new T.Vector3(), 0);
    }
    return geometry;
  }
  function read(geometry) {
    if (!geometry || !geometry.isBufferGeometry || !geometry.attributes.position) {
      throw new Error('A mesh with position geometry is required.');
    }
    var position = geometry.attributes.position;
    if (position.itemSize < 3 || position.count > 600000) throw new Error('Unsupported mesh size or positions.');
    var count = geometry.index ? geometry.index.count : position.count;
    if (count % 3 || count > MAX_FACES * 3) throw new Error('Geometry must contain triangles within the face limit.');
    var color = geometry.attributes.color;
    if (color && (color.count !== position.count || color.itemSize < 3 || color.itemSize > 4)) throw new Error('Unsupported vertex colors.');
    return { position: position, index: geometry.index, uv: geometry.attributes.uv, color: color,
      faces: count / 3, materials: groupsFor(geometry, count / 3) };
  }
  function colorComponent(attribute, index, channel) {
    // Read the backing array so integer normalization is consistent in r128
    // (whose getters return raw values) and newer THREE versions.
    var array = attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array;
    var offset = attribute.isInterleavedBufferAttribute ? index * attribute.data.stride + attribute.offset + channel : index * attribute.itemSize + channel;
    var value = array[offset];
    if (attribute.normalized) {
      if (array instanceof Uint8Array || array instanceof Uint8ClampedArray) value /= 255;
      else if (array instanceof Uint16Array) value /= 65535;
      else if (array instanceof Uint32Array) value /= 4294967295;
      else if (array instanceof Int8Array) value = Math.max(-1, value / 127);
      else if (array instanceof Int16Array) value = Math.max(-1, value / 32767);
      else if (array instanceof Int32Array) value = Math.max(-1, value / 2147483647);
    }
    if (!Number.isFinite(value)) throw new Error('Mesh contains invalid vertex colors.');
    return value;
  }
  function arrays(geometry) {
    var data = read(geometry), p = [], uv = data.uv ? [] : null, idx = [], colors = data.color ? { values: [], itemSize: data.color.itemSize } : null;
    for (var i = 0; i < data.position.count; i++) {
      p.push(data.position.getX(i), data.position.getY(i), data.position.getZ(i));
      if (uv) uv.push(data.uv.getX(i), data.uv.getY(i));
      if (colors) for (var channel = 0; channel < colors.itemSize; channel++) colors.values.push(colorComponent(data.color, i, channel));
    }
    for (var j = 0; j < data.faces * 3; j++) idx.push(data.index ? data.index.getX(j) : j);
    return { positions: p, indices: idx, uv: uv, materials: data.materials, colors: colors };
  }

  // Welding intentionally keeps the first UV at a seam so each topology vertex
  // has one editable position. Imported hard normals are recomputed as smooth.
  function canonicalize(geometry) {
    var data = read(geometry), positions = [], uv = data.uv ? [] : null, colors = data.color ? { values: [], itemSize: data.color.itemSize } : null;
    var buckets = new Map(), remap = new Int32Array(data.position.count), indices = [], materials = data.materials ? [] : null;
    for (var i = 0; i < data.position.count; i++) {
      var x = data.position.getX(i), y = data.position.getY(i), z = data.position.getZ(i);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error('Mesh contains invalid coordinates.');
      var bx = Math.floor(x / TOLERANCE), by = Math.floor(y / TOLERANCE), bz = Math.floor(z / TOLERANCE), match = -1;
      for (var dx = -1; dx <= 1 && match < 0; dx++) for (var dy = -1; dy <= 1 && match < 0; dy++) for (var dz = -1; dz <= 1 && match < 0; dz++) {
        var candidates = buckets.get((bx + dx) + ',' + (by + dy) + ',' + (bz + dz));
        if (!candidates) continue;
        for (var c = 0; c < candidates.length; c++) {
          var v = candidates[c], px = positions[v * 3] - x, py = positions[v * 3 + 1] - y, pz = positions[v * 3 + 2] - z;
          if (px * px + py * py + pz * pz <= TOLERANCE * TOLERANCE) { match = v; break; }
        }
      }
      if (match < 0) {
        match = positions.length / 3; budget(match + 1, 0);
        positions.push(x, y, z);
        if (uv) {
          var u = data.uv.getX(i), vv = data.uv.getY(i);
          uv.push(Number.isFinite(u) ? u : 0, Number.isFinite(vv) ? vv : 0);
        }
        if (colors) for (var channel = 0; channel < colors.itemSize; channel++) colors.values.push(colorComponent(data.color, i, channel));
        var bucketKey = bx + ',' + by + ',' + bz;
        if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
        buckets.get(bucketKey).push(match);
      }
      remap[i] = match;
    }
    function sourceIndex(offset) {
      var index = data.index ? data.index.getX(offset) : offset;
      if (!Number.isInteger(index) || index < 0 || index >= remap.length) throw new Error('Mesh contains an invalid triangle index.');
      return remap[index];
    }
    for (var f = 0; f < data.faces; f++) {
      var a = sourceIndex(f * 3), b = sourceIndex(f * 3 + 1), cc = sourceIndex(f * 3 + 2);
      if (a === b || b === cc || cc === a) continue;
      var abx = positions[b * 3] - positions[a * 3], aby = positions[b * 3 + 1] - positions[a * 3 + 1], abz = positions[b * 3 + 2] - positions[a * 3 + 2];
      var acx = positions[cc * 3] - positions[a * 3], acy = positions[cc * 3 + 1] - positions[a * 3 + 1], acz = positions[cc * 3 + 2] - positions[a * 3 + 2];
      var nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      if (nx * nx + ny * ny + nz * nz <= 1e-20) continue;
      indices.push(a, b, cc); if (materials) materials.push(data.materials[f]);
    }
    return compact(positions, indices, uv, materials, colors);
  }
  function compact(positions, indices, uv, materials, colors) {
    var map = new Map(), p = [], u = uv ? [] : null, c = colors ? { values: [], itemSize: colors.itemSize } : null;
    var index = indices.map(function (old) {
      if (!map.has(old)) {
        map.set(old, p.length / 3); p.push(positions[old * 3], positions[old * 3 + 1], positions[old * 3 + 2]);
        if (u) u.push(uv[old * 2], uv[old * 2 + 1]);
        if (c) for (var channel = 0; channel < c.itemSize; channel++) c.values.push(colors.values[old * c.itemSize + channel]);
      }
      return map.get(old);
    });
    return finish(p, index, u, materials, c);
  }
  function primitive(shape, segments) {
    var T = three(), s = integer(segments, 4, 1, 32, 'Segments'), geometry;
    switch (String(shape).toLowerCase()) {
      case 'box': case 'cube': geometry = new T.BoxGeometry(2, 2, 2, s, s, s); break;
      case 'sphere': geometry = new T.SphereGeometry(1, Math.max(8, s * 2), Math.max(4, s)); break;
      case 'cylinder': geometry = new T.CylinderGeometry(1, 1, 2, Math.max(8, s * 2), s); break;
      case 'cone': geometry = new T.ConeGeometry(1, 2, Math.max(8, s * 2), s); break;
      case 'torus': geometry = new T.TorusGeometry(0.72, 0.28, Math.max(4, s), Math.max(8, s * 2)); break;
      case 'plane': geometry = new T.PlaneGeometry(2, 2, s, s); break;
      // Icosahedron detail is exponential; cap it independently of segment UI.
      case 'icosphere': case 'icosahedron': geometry = new T.IcosahedronGeometry(1, Math.min(5, Math.floor(Math.log2(s)))); break;
      default: throw new Error('Unknown shape: ' + shape);
    }
    var result = canonicalize(geometry); geometry.dispose(); return result;
  }
  function topology(geometry) {
    var data = read(geometry), edges = new Map();
    for (var f = 0; f < data.faces; f++) {
      var a = data.index ? data.index.getX(f * 3) : f * 3;
      var b = data.index ? data.index.getX(f * 3 + 1) : f * 3 + 1;
      var c = data.index ? data.index.getX(f * 3 + 2) : f * 3 + 2;
      [[a, b], [b, c], [c, a]].forEach(function (edge) {
        var id = key(edge[0], edge[1]); if (!edges.has(id)) edges.set(id, edge[0] < edge[1] ? edge : [edge[1], edge[0]]);
      });
    }
    return { vertices: data.position.count, faces: data.faces, edges: Array.from(edges.values()), groups: geometry.groups.slice() };
  }
  function subdivide(geometry) {
    var input = geometry.index ? geometry : canonicalize(geometry), d = arrays(input), edgeMap = new Map(), idx = [], material = d.materials ? [] : null;
    budget(d.positions.length / 3 + topology(input).edges.length, d.indices.length / 3 * 4);
    function midpoint(a, b) {
      var id = key(a, b); if (edgeMap.has(id)) return edgeMap.get(id);
      var n = d.positions.length / 3;
      for (var k = 0; k < 3; k++) d.positions.push((d.positions[a * 3 + k] + d.positions[b * 3 + k]) / 2);
      if (d.uv) for (var t = 0; t < 2; t++) d.uv.push((d.uv[a * 2 + t] + d.uv[b * 2 + t]) / 2);
      if (d.colors) for (var channel = 0; channel < d.colors.itemSize; channel++) d.colors.values.push((d.colors.values[a * d.colors.itemSize + channel] + d.colors.values[b * d.colors.itemSize + channel]) / 2);
      edgeMap.set(id, n); return n;
    }
    for (var f = 0; f < d.indices.length / 3; f++) {
      var a = d.indices[f * 3], b = d.indices[f * 3 + 1], c = d.indices[f * 3 + 2];
      var ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      idx.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      if (material) for (var t = 0; t < 4; t++) material.push(d.materials[f]);
    }
    return finish(d.positions, idx, d.uv, material, d.colors);
  }
  function faceSet(faceIndices, count) {
    if (!faceIndices || typeof faceIndices[Symbol.iterator] !== 'function') throw new Error('Select at least one face.');
    var selected = new Set();
    for (var f of faceIndices) selected.add(integer(f, -1, 0, count - 1, 'Face index'));
    if (!selected.size) throw new Error('Select at least one face.');
    return selected;
  }
  function deleteFaces(geometry, faceIndices) {
    var d = arrays(geometry), selected = faceSet(faceIndices, d.indices.length / 3), idx = [], material = d.materials ? [] : null;
    for (var f = 0; f < d.indices.length / 3; f++) if (!selected.has(f)) {
      idx.push(d.indices[f * 3], d.indices[f * 3 + 1], d.indices[f * 3 + 2]);
      if (material) material.push(d.materials[f]);
    }
    return compact(d.positions, idx, d.uv, material, d.colors);
  }
  function extrudeFaces(geometry, faceIndices, distance) {
    var T = three(), d = arrays(geometry), selected = faceSet(faceIndices, d.indices.length / 3);
    var amount = number(distance, 0.2, -100, 100, 'Extrusion distance');
    if (Math.abs(amount) < TOLERANCE) return geometry.clone();
    var normal = new T.Vector3(), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), ab = new T.Vector3(), ac = new T.Vector3();
    var edgeMap = new Map(), selectedVertices = new Set(), top = new Map();
    selected.forEach(function (f) {
      var va = d.indices[f * 3], vb = d.indices[f * 3 + 1], vc = d.indices[f * 3 + 2];
      selectedVertices.add(va); selectedVertices.add(vb); selectedVertices.add(vc);
      a.fromArray(d.positions, va * 3); b.fromArray(d.positions, vb * 3); c.fromArray(d.positions, vc * 3);
      normal.add(ab.subVectors(b, a).cross(ac.subVectors(c, a)));
      [[va, vb], [vb, vc], [vc, va]].forEach(function (edge) {
        var id = key(edge[0], edge[1]);
        if (edgeMap.has(id)) edgeMap.get(id).count++;
        else edgeMap.set(id, { a: edge[0], b: edge[1], count: 1, material: d.materials ? d.materials[f] : 0 });
      });
    });
    if (normal.lengthSq() < 1e-16) throw new Error('The selected faces have no shared extrusion direction. Select a smaller surface.');
    normal.normalize().multiplyScalar(amount);
    var boundary = Array.from(edgeMap.values()).filter(function (edge) { return edge.count === 1; });
    budget(d.positions.length / 3 + selectedVertices.size, d.indices.length / 3 + boundary.length * 2);
    selectedVertices.forEach(function (v) {
      top.set(v, d.positions.length / 3);
      d.positions.push(d.positions[v * 3] + normal.x, d.positions[v * 3 + 1] + normal.y, d.positions[v * 3 + 2] + normal.z);
      if (d.uv) d.uv.push(d.uv[v * 2], d.uv[v * 2 + 1]);
      if (d.colors) for (var channel = 0; channel < d.colors.itemSize; channel++) d.colors.values.push(d.colors.values[v * d.colors.itemSize + channel]);
    });
    var idx = [], material = d.materials ? [] : null;
    for (var f = 0; f < d.indices.length / 3; f++) {
      for (var k = 0; k < 3; k++) { var v = d.indices[f * 3 + k]; idx.push(selected.has(f) ? top.get(v) : v); }
      if (material) material.push(d.materials[f]);
    }
    boundary.forEach(function (edge) {
      var a = edge.a, b = edge.b, ta = top.get(a), tb = top.get(b);
      idx.push(a, b, tb, a, tb, ta);
      if (material) material.push(edge.material, edge.material);
    });
    return canonicalize(finish(d.positions, idx, d.uv, material, d.colors));
  }
  function smooth(geometry, params) {
    var d = arrays(geometry), count = d.positions.length / 3;
    var iterations = integer(params.iterations, 1, 1, 20, 'Smooth iterations');
    var strength = number(params.strength, 0.5, 0, 1, 'Smooth strength');
    var adjacency = Array.from({ length: count }, function () { return new Set(); }), edges = new Map(), boundary = new Set();
    for (var f = 0; f < d.indices.length; f += 3) {
      var a = d.indices[f], b = d.indices[f + 1], c = d.indices[f + 2];
      [[a, b], [b, c], [c, a]].forEach(function (edge) {
        adjacency[edge[0]].add(edge[1]); adjacency[edge[1]].add(edge[0]);
        var id = key(edge[0], edge[1]);
        if (edges.has(id)) edges.get(id).count++; else edges.set(id, { a: edge[0], b: edge[1], count: 1 });
      });
    }
    if (params.preserveBoundary !== false) edges.forEach(function (edge) { if (edge.count === 1) { boundary.add(edge.a); boundary.add(edge.b); } });
    for (var step = 0; step < iterations; step++) {
      var next = d.positions.slice();
      for (var i = 0; i < count; i++) {
        if (boundary.has(i) || !adjacency[i].size) continue;
        for (var axis = 0; axis < 3; axis++) {
          var sum = 0; adjacency[i].forEach(function (neighbor) { sum += d.positions[neighbor * 3 + axis]; });
          next[i * 3 + axis] += (sum / adjacency[i].size - d.positions[i * 3 + axis]) * strength;
        }
      }
      d.positions = next;
    }
    return canonicalize(finish(d.positions, d.indices, d.uv, d.materials, d.colors));
  }
  // Continuous seeded value noise keeps the result stable after reloads.
  function noise3(x, y, z, seed) {
    function hash(a, b, c) { var n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647) ^ seed; n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967295; }
    function fade(t) { return t * t * (3 - 2 * t); }
    function mix(a, b, t) { return a + (b - a) * t; }
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), tx = fade(x - ix), ty = fade(y - iy), tz = fade(z - iz);
    var lo = mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), tx), mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), tx), ty);
    var hi = mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), tx), mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), tx), ty);
    return mix(lo, hi, tz) * 2 - 1;
  }
  function applyNode(geometry, node) {
    if (!node || typeof node !== 'object') throw new Error('A geometry node is required.');
    if (node.enabled === false) return geometry.clone();
    var type = String(node.type || '').toLowerCase(), p = node.params || node;
    var T = three(), output;
    if (type === 'subdivide' || type === 'subdivision') {
      var level = integer(p.level !== undefined ? p.level : p.levels, 1, 0, 5, 'Subdivision level');
      output = geometry.clone();
      for (var l = 0; l < level; l++) { var next = subdivide(output); output.dispose(); output = next; }
      return output;
    }
    if (type === 'smooth') return smooth(geometry, p);
    output = geometry.clone();
    if (type === 'transform') {
      var position = new T.Vector3(number(p.x, 0, -10000, 10000, 'X'), number(p.y, 0, -10000, 10000, 'Y'), number(p.z, 0, -10000, 10000, 'Z'));
      var rotation = new T.Euler(number(p.rx, 0, -36000, 36000, 'Rotation X') * Math.PI / 180, number(p.ry, 0, -36000, 36000, 'Rotation Y') * Math.PI / 180, number(p.rz, 0, -36000, 36000, 'Rotation Z') * Math.PI / 180);
      var scale = new T.Vector3(number(p.sx, 1, -1000, 1000, 'Scale X'), number(p.sy, 1, -1000, 1000, 'Scale Y'), number(p.sz, 1, -1000, 1000, 'Scale Z'));
      if (Math.abs(scale.x * scale.y * scale.z) < 1e-9) throw new Error('Transform scale cannot collapse a dimension.');
      output.applyMatrix4(new T.Matrix4().compose(position, new T.Quaternion().setFromEuler(rotation), scale));
      // Negative scale changes handedness; restore outward winding without
      // welding an imported mesh's UV or hard-normal seams.
      if (scale.x * scale.y * scale.z < 0) {
        var ii = output.index;
        if (ii) {
          for (var f = 0; f < ii.count; f += 3) { var b = ii.getX(f + 1); ii.setX(f + 1, ii.getX(f + 2)); ii.setX(f + 2, b); }
          ii.needsUpdate = true;
        } else {
          Object.keys(output.attributes).forEach(function (name) {
            var attribute = output.attributes[name], getters = ['getX','getY','getZ','getW'], setters = ['setX','setY','setZ','setW'];
            if (attribute.itemSize > 4) throw new Error('Unsupported non-indexed mesh attribute.');
            for (var f = 0; f < attribute.count; f += 3) for (var channel = 0; channel < attribute.itemSize; channel++) {
              var value = attribute[getters[channel]](f + 1);
              attribute[setters[channel]](f + 1, attribute[getters[channel]](f + 2));
              attribute[setters[channel]](f + 2, value);
            }
            attribute.needsUpdate = true;
          });
        }
      }
    } else if (type === 'twist') {
      var angle = number(p.angle, 90, -36000, 36000, 'Twist angle') * Math.PI / 180;
      output.computeBoundingBox(); var span = output.boundingBox.max.y - output.boundingBox.min.y, center = (output.boundingBox.max.y + output.boundingBox.min.y) / 2;
      var attr = output.attributes.position;
      if (span > TOLERANCE) for (var i = 0; i < attr.count; i++) {
        var theta = angle * (attr.getY(i) - center) / span, cosine = Math.cos(theta), sine = Math.sin(theta), x = attr.getX(i), z = attr.getZ(i);
        attr.setXYZ(i, x * cosine + z * sine, attr.getY(i), -x * sine + z * cosine);
      }
    } else if (type === 'noise' || type === 'displace') {
      var amount = number(p.amount, 0.15, -100, 100, 'Noise amount'), frequency = number(p.scale, 2, 0.001, 1000, 'Noise scale'), seed = integer(p.seed, 1, -2147483648, 2147483647, 'Noise seed');
      output.computeVertexNormals(); var pos = output.attributes.position, normals = output.attributes.normal;
      for (var v = 0; v < pos.count; v++) {
        var x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v), delta = noise3(x * frequency, y * frequency, z * frequency, seed) * amount;
        pos.setXYZ(v, x + normals.getX(v) * delta, y + normals.getY(v) * delta, z + normals.getZ(v) * delta);
      }
    } else if (type === 'spherize' || type === 'sphere') {
      var amount = number(p.amount, 1, 0, 1, 'Spherize amount'), radius = number(p.radius, 1, 0.001, 1000, 'Radius'), pos = output.attributes.position;
      for (var v = 0; v < pos.count; v++) {
        var x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v), length = Math.sqrt(x * x + y * y + z * z);
        if (length > TOLERANCE) { var factor = 1 + (radius / length - 1) * amount; pos.setXYZ(v, x * factor, y * factor, z * factor); }
      }
    } else if (type === 'array') {
      output.dispose(); var d = arrays(geometry), copies = integer(p.count, 3, 1, 32, 'Array count'), axis = String(p.axis || 'x').toLowerCase(), spacing = number(p.spacing, 2.5, -1000, 1000, 'Array spacing');
      if (['x', 'y', 'z'].indexOf(axis) < 0) throw new Error('Array axis must be X, Y, or Z.');
      budget(d.positions.length / 3 * copies, d.indices.length / 3 * copies);
      var pOut = [], iOut = [], uvOut = d.uv ? [] : null, mOut = d.materials ? [] : null, cOut = d.colors ? { values: [], itemSize: d.colors.itemSize } : null, coordinate = ['x', 'y', 'z'].indexOf(axis);
      for (var copy = 0; copy < copies; copy++) {
        for (var v = 0; v < d.positions.length; v++) pOut.push(d.positions[v] + (v % 3 === coordinate ? copy * spacing : 0));
        for (var k = 0; k < d.indices.length; k++) iOut.push(d.indices[k] + copy * d.positions.length / 3);
        if (uvOut) for (var u = 0; u < d.uv.length; u++) uvOut.push(d.uv[u]);
        if (mOut) for (var m = 0; m < d.materials.length; m++) mOut.push(d.materials[m]);
        if (cOut) for (var channel = 0; channel < d.colors.values.length; channel++) cOut.values.push(d.colors.values[channel]);
      }
      output = finish(pOut, iOut, uvOut, mOut, cOut);
    } else { output.dispose(); throw new Error('Unknown geometry node: ' + type); }
    if (type === 'array') { try { return canonicalize(output); } finally { output.dispose(); } }
    // A deformation changes positions, never topology. Preserve duplicate seam
    // vertices and all imported attributes until the user explicitly edits it.
    try {
      var attribute = output.attributes.position;
      for (var i = 0; i < attribute.count; i++) if (!Number.isFinite(attribute.getX(i)) || !Number.isFinite(attribute.getY(i)) || !Number.isFinite(attribute.getZ(i))) throw new Error('Node produced invalid coordinates.');
      attribute.needsUpdate = true;
      if (type !== 'transform') output.computeVertexNormals();
      if (attribute.count) { output.computeBoundingBox(); output.computeBoundingSphere(); }
      else { output.boundingBox = new T.Box3(new T.Vector3(), new T.Vector3()); output.boundingSphere = new T.Sphere(new T.Vector3(), 0); }
      return output;
    } catch (error) { output.dispose(); throw error; }
  }
  function serialize(geometry) {
    var d = arrays(geometry), attribute = geometry.attributes.normal, normals = null;
    if (attribute) {
      if (attribute.itemSize !== 3 || attribute.count !== d.positions.length / 3) throw new Error('Invalid mesh normals.');
      normals = [];
      for (var i = 0; i < attribute.count; i++) for (var channel = 0; channel < 3; channel++) normals.push(colorComponent(attribute, i, channel));
    }
    return { version: 1, positions: d.positions, indices: d.indices, uv: d.uv, materials: d.materials,
      color: d.colors ? d.colors.values : null, colorItemSize: d.colors ? d.colors.itemSize : 3, normal: normals };
  }
  function deserialize(data) {
    if (!data || !Array.isArray(data.positions) || !Array.isArray(data.indices) || data.positions.length % 3 || data.indices.length % 3) throw new Error('Invalid saved geometry.');
    budget(data.positions.length / 3, data.indices.length / 3);
    if (data.uv && (!Array.isArray(data.uv) || data.uv.length !== data.positions.length / 3 * 2)) throw new Error('Invalid saved UVs.');
    if (data.materials && (!Array.isArray(data.materials) || data.materials.length !== data.indices.length / 3)) throw new Error('Invalid saved material groups.');
    var colorSize = data.colorItemSize === undefined ? 3 : integer(data.colorItemSize, 3, 3, 4, 'Vertex color size');
    if (data.color && (!Array.isArray(data.color) || data.color.length !== data.positions.length / 3 * colorSize)) throw new Error('Invalid saved vertex colors.');
    if (data.normal && (!Array.isArray(data.normal) || data.normal.length !== data.positions.length)) throw new Error('Invalid saved normals.');
    data.positions.forEach(function (n) { if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e10) throw new Error('Invalid saved vertex.'); });
    data.indices.forEach(function (i) { integer(i, -1, 0, data.positions.length / 3 - 1, 'Saved index'); });
    if (data.uv) data.uv.forEach(function (n) { if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('Invalid saved UV.'); });
    if (data.materials) data.materials.forEach(function (n) { integer(n, 0, 0, 10000, 'Material index'); });
    if (data.color) data.color.forEach(function (n) { if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('Invalid saved vertex color.'); });
    if (data.normal) data.normal.forEach(function (n) { if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('Invalid saved normal.'); });
    // Saved vertex/face IDs are also used by editor selections and undo. The
    // data is already validated above; retain its exact order on restoration.
    var result = finish(data.positions, data.indices, data.uv, data.materials, data.color ? { values: data.color, itemSize: colorSize } : null);
    if (data.normal) result.setAttribute('normal', new (three().Float32BufferAttribute)(data.normal, 3));
    return result;
  }
  return { canonicalize: canonicalize, primitive: primitive, primitives: primitive,
    topology: topology, subdivide: subdivide, deleteFaces: deleteFaces, extrudeFaces: extrudeFaces,
    applyNode: applyNode, serialize: serialize, deserialize: deserialize,
    MAX_VERTICES: MAX_VERTICES, MAX_FACES: MAX_FACES, TOLERANCE: TOLERANCE };
});
