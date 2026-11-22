# Walls are a graph of shared nodes, not independent segments

Walls are stored as edges between shared Wall Nodes rather than as standalone `a`/`b` segments. This costs extra editing logic (splitting walls at T-junctions, merging nodes), but corners stay joined when edited, joins render cleanly, and rooms, navigation graphs and IMDF units can later be derived without migrating the Document format — moving from segments to a graph later would be a breaking migration. The MVP does not derive rooms automatically; Zones are drawn by hand.
