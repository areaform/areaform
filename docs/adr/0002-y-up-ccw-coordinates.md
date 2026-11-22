# Model coordinates are Y-up, metres, with GeoJSON winding

All geometry is in metres in a Y-up plane ("up on the plan" = +Y), even though every 2D renderer we target (Canvas, SVG, PixiJS) is Y-down; the renderer flips. This matches maths, GIS and MapLibre after the georeference transform, so geometry and future map/IMDF export need no axis juggling. Outer rings are counter-clockwise and holes clockwise (RFC 7946); the core normalises winding on write so callers never have to care.
