// Neo4j 제약조건. 구조 설명은 cim/graph.py 참고
CREATE CONSTRAINT substation_id IF NOT EXISTS FOR (s:Substation) REQUIRE s.id IS UNIQUE;
CREATE CONSTRAINT feeder_id IF NOT EXISTS FOR (f:Feeder) REQUIRE f.id IS UNIQUE;
CREATE CONSTRAINT node_id IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE;
CREATE INDEX line_id IF NOT EXISTS FOR ()-[l:LINE]-() ON (l.id);
