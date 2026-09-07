extends RefCounted
## VillageGen adapter over unmodified MIT Road Generator. Bake one template
## per length/axis, then discard authoring nodes. C# owns terrain and physics.
func bake(map:Dictionary,parent:Node)->Array:
	var manager:=RoadManager.new()
	parent.add_child(manager)
	var bridges:Dictionary={}
	for road in map.roads:
		if road.get("bridge",false): bridges[Vector2i(int(road.x),int(road.y))]=true
	var templates:Dictionary={}
	var result:Array=[]
	for segment in map.roadSegments:
		var cells:Array=segment.roadIndexes
		if cells.size()<2: continue
		var ew:bool=segment.axis=="ew"
		var safe:=true
		for index in cells:
			var road:Dictionary=map.roads[int(index)]
			if road.get("bridge",false) or int(road.connections)!=(10 if ew else 5): safe=false
			for direction in [Vector2i.ZERO,Vector2i.LEFT,Vector2i.RIGHT,Vector2i.UP,Vector2i.DOWN]:
				if bridges.has(Vector2i(int(road.x),int(road.y))+direction): safe=false
		if not safe: continue
		var first:Dictionary=map.roads[int(cells[0])]
		var key:String="%s:%d" % [segment.axis,cells.size()]
		if not templates.has(key):
			var container:=RoadContainer.new()
			manager.add_child(container)
			container._auto_refresh=false
			# Only geometry is consumed; avoid compiling the editor's road shader.
			container.material_resource=StandardMaterial3D.new()
			container.generate_ai_lanes=false
			container.override_collision_layers=true
			container.collision_layer=0
			container.collision_mask=0
			container.density=1.0
			var points:Array[RoadPoint]=[]
			for position in ([Vector3(0,0,.5),Vector3(cells.size(),0,.5)] if ew else [Vector3(.5,0,0),Vector3(.5,0,cells.size())]):
				var point:=RoadPoint.new()
				point.position=position
				point.rotation.y=PI/2 if ew else 0.0
				point.traffic_dir=[RoadPoint.LaneDir.REVERSE,RoadPoint.LaneDir.FORWARD]
				point.lane_width=.5
				point.shoulder_width_l=0
				point.shoulder_width_r=0
				point.gutter_profile=Vector2.ZERO
				point.alignment=RoadPoint.Alignment.DIVIDER
				container.add_child(point)
				points.append(point)
			points[0].connect_roadpoint(RoadPoint.PointInit.NEXT,points[1],RoadPoint.PointInit.PRIOR)
			container.update_edges()
			container._auto_refresh=true
			container.rebuild_segments(true)
			var faces:=PackedVector3Array()
			for mesh in container.find_children("*","MeshInstance3D",true,false):
				if mesh.mesh!=null:
					for vertex in mesh.mesh.get_faces(): faces.append(mesh.to_global(vertex))
			templates[key]=faces
		var translated:PackedVector3Array=templates[key].duplicate()
		for i in range(translated.size()):
			translated[i]+=Vector3(float(first.x),0,float(first.y))
		result.append({"cells":cells,"faces":translated})
	manager.free()
	return result
