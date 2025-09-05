// ======================================================================
// NavMesh Visualizer for destroMOD H1Z1 Server
// Provides in-game visualization of navigation mesh and pathfinding data
// ======================================================================

"use strict";

const path = require('path');
const serverModulePath = path.join(process.cwd(), 'node_modules/h1z1-server');
const { getCurrentServerTimeWrapper } = require(path.join(serverModulePath, 'out/utils/utils'));

class NavMeshVisualizer {
    constructor(pathfindingManager) {
        this.pathfindingManager = pathfindingManager;
        this.server = null;
        this.isEnabled = false;
        this.debugPlayers = new Set(); // Players with debug visualization enabled
        this.visualizationObjects = new Map(); // Track spawned debug objects
        this.lastVisualizationUpdate = 0;
        this.updateInterval = 5000; // Update every 5 seconds
        
        // Visual settings
        this.settings = {
            navMeshColor: 0x00FF00,      // Green for walkable areas
            pathColor: 0x0000FF,         // Blue for paths
            agentColor: 0xFF0000,        // Red for agents
            obstacleColor: 0x808080,     // Gray for obstacles
            maxVisualizationDistance: 100, // Only show within 100 units
            effectDuration: 10000,       // Effects last 10 seconds
        };
        
        console.log(`[NavMeshVisualizer] Initialized with recast-navigation integration`);
    }

    setServer(server) {
        this.server = server;
    }

    // ===== MAIN VISUALIZATION COMMANDS =====

    /**
     * Toggle navmesh visualization for a player
     */
    toggleNavMeshVisualization(player) {
        const playerId = player.characterId;
        
        if (this.debugPlayers.has(playerId)) {
            this.debugPlayers.delete(playerId);
            this.clearVisualizationForPlayer(player);
            this.sendMessage(player, "🗺️ NavMesh visualization: OFF");
            return false;
        } else {
            this.debugPlayers.add(playerId);
            this.showNavMeshForPlayer(player);
            this.sendMessage(player, "🗺️ NavMesh visualization: ON");
            return true;
        }
    }

    /**
     * Show navigation mesh around player
     */
    showNavMeshForPlayer(player) {
        if (!this.pathfindingManager || !this.pathfindingManager.isReady) {
            this.sendMessage(player, "❌ Pathfinding system not ready");
            return;
        }

        try {
            const playerPos = player.character.state.position;
            console.log(`[NavMeshVisualizer] Generating navmesh visualization around position: [${playerPos[0].toFixed(1)}, ${playerPos[1].toFixed(1)}, ${playerPos[2].toFixed(1)}]`);
            
            // Extract navmesh data using recast-navigation
            const navMeshData = this.extractNavMeshData(playerPos, this.settings.maxVisualizationDistance);
            
            if (navMeshData && navMeshData.polygons.length > 0) {
                this.createNavMeshEffects(player, navMeshData);
                this.sendMessage(player, `✅ Showing ${navMeshData.polygons.length} nav polygons`);
            } else {
                this.sendMessage(player, "⚠️ No navmesh data found in this area");
            }
            
        } catch (error) {
            console.error(`[NavMeshVisualizer] Error showing navmesh:`, error);
            this.sendMessage(player, "❌ Error generating navmesh visualization");
        }
    }

    /**
     * Visualize current agent paths
     */
    showAgentPaths(player) {
        if (!this.pathfindingManager || !this.pathfindingManager.crowd) {
            this.sendMessage(player, "❌ Crowd system not available");
            return;
        }

        try {
            const activeAgents = this.pathfindingManager.agents;
            let visualizedCount = 0;

            for (const [npcId, agentData] of activeAgents.entries()) {
                const npc = this.server._npcs[npcId];
                if (!npc || !npc.isAlive) continue;

                try {
                    // Get agent from crowd using agentIndex
                    const agent = this.pathfindingManager.crowd.getAgent(agentData.agentIndex);
                    if (!agent) continue;

                    // Get agent position and target
                    let agentPos;
                    try {
                        agentPos = agent.position();
                    } catch (e) {
                        agentPos = agent.interpolatedPosition;
                    }

                    if (agentPos) {
                        // Create visual marker at agent position
                        this.createAgentMarker(player, agentPos, npcId);
                        
                        // Try to get and visualize the agent's path
                        try {
                            const agentPath = this.getAgentPath(agent);
                            if (agentPath && agentPath.length > 1) {
                                this.createPathVisualization(player, agentPath, npcId);
                            }
                        } catch (pathError) {
                            console.warn(`[NavMeshVisualizer] Could not get path for agent ${agentData.agentIndex}:`, pathError.message);
                        }

                        visualizedCount++;
                    }

                } catch (agentError) {
                    console.warn(`[NavMeshVisualizer] Error visualizing agent ${agentData.agentIndex}:`, agentError.message);
                }
            }

            this.sendMessage(player, `✨ Visualized ${visualizedCount} active agents`);
            
        } catch (error) {
            console.error(`[NavMeshVisualizer] Error showing agent paths:`, error);
            this.sendMessage(player, "❌ Error visualizing agent paths");
        }
    }

    /**
     * Test pathfinding and show the result
     */
    testAndVisualizePath(player, targetPos) {
        if (!this.pathfindingManager || !this.pathfindingManager.isReady) {
            this.sendMessage(player, "❌ Pathfinding system not ready");
            return;
        }

        try {
            const startPos = player.character.state.position;
            
            // Use pathfinding manager's test function
            const pathPoints = this.pathfindingManager.testNavMesh(startPos, targetPos);
            
            if (pathPoints && pathPoints.length > 0) {
                // Convert Float32Array points to visualization format
                const pathData = pathPoints.map((point, index) => ({
                    position: Array.isArray(point) ? point : [point[0], point[1], point[2]],
                    index: index,
                    isStart: index === 0,
                    isEnd: index === pathPoints.length - 1
                }));

                this.createPathVisualization(player, pathData, 'test_path');
                this.sendMessage(player, `🎯 Path found with ${pathPoints.length} waypoints`);
                
                // Auto-clear after 15 seconds
                setTimeout(() => {
                    this.clearPathVisualization(player, 'test_path');
                }, 15000);
                
                return true;
            } else {
                this.sendMessage(player, "❌ No path found between those points");
                return false;
            }
            
        } catch (error) {
            console.error(`[NavMeshVisualizer] Error testing path:`, error);
            this.sendMessage(player, "❌ Error testing pathfinding");
            return false;
        }
    }

    // ===== DATA EXTRACTION METHODS =====

    /**
     * Extract navmesh polygon data around a position
     */
    extractNavMeshData(centerPos, radius) {
        try {
            if (!this.pathfindingManager.navmesh) {
                console.warn(`[NavMeshVisualizer] NavMesh not available`);
                return null;
            }

            const navMesh = this.pathfindingManager.navmesh;
            
            // This is a simplified approach - actual implementation would depend on
            // the specific methods available in your recast-navigation version
            
            const polygons = [];
            const edges = [];
            
            // Attempt to extract tile data (this API may vary based on version)
            try {
                // Get tiles around the center position
                const tilesData = this.extractTilesAroundPosition(navMesh, centerPos, radius);
                
                for (const tileData of tilesData) {
                    // Extract polygons from each tile
                    const tilePolygons = this.extractPolygonsFromTile(tileData);
                    polygons.push(...tilePolygons);
                    
                    // Extract edges for visualization
                    const tileEdges = this.extractEdgesFromTile(tileData);
                    edges.push(...tileEdges);
                }
                
            } catch (extractError) {
                console.warn(`[NavMeshVisualizer] Could not extract detailed mesh data:`, extractError.message);
                
                // Fallback: Create basic visualization using pathfinding tests
                return this.createFallbackVisualization(centerPos, radius);
            }
            
            return {
                polygons: polygons,
                edges: edges,
                centerPos: centerPos,
                radius: radius
            };
            
        } catch (error) {
            console.error(`[NavMeshVisualizer] Error extracting navmesh data:`, error);
            return null;
        }
    }

    /**
     * Fallback visualization using pathfinding tests
     */
    createFallbackVisualization(centerPos, radius) {
        const testPoints = [];
        const gridSize = 5; // Test every 5 units
        
        // Create a grid of test points around the center
        for (let x = -radius; x <= radius; x += gridSize) {
            for (let z = -radius; z <= radius; z += gridSize) {
                const testPos = [
                    centerPos[0] + x,
                    centerPos[1],
                    centerPos[2] + z
                ];
                
                // Test if this point is on the navmesh
                try {
                    const nearestPoint = this.pathfindingManager.getClosestNavPoint(testPos);
                    if (nearestPoint) {
                        testPoints.push({
                            position: [nearestPoint.x, nearestPoint.y, nearestPoint.z],
                            isWalkable: true
                        });
                    }
                } catch (e) {
                    // Point not on navmesh
                    testPoints.push({
                        position: testPos,
                        isWalkable: false
                    });
                }
            }
        }
        
        return {
            polygons: testPoints.filter(p => p.isWalkable),
            edges: [],
            centerPos: centerPos,
            radius: radius,
            isFallback: true
        };
    }

    /**
     * Get the path that an agent is following
     */
    getAgentPath(agent) {
        try {
            // This would depend on the specific API available in your recast-navigation version
            // Some possible methods:
            
            if (typeof agent.path === 'function') {
                return agent.path();
            } else if (agent.pathPoints) {
                return agent.pathPoints;
            } else if (typeof agent.getPath === 'function') {
                return agent.getPath();
            }
            
            // If no direct path access, return current position only
            let position;
            try {
                position = agent.position();
            } catch (e) {
                position = agent.interpolatedPosition;
            }
            
            if (position) {
                return [{
                    position: [position.x, position.y, position.z],
                    index: 0,
                    isStart: true,
                    isEnd: true
                }];
            }
            
            return null;
            
        } catch (error) {
            console.warn(`[NavMeshVisualizer] Error getting agent path:`, error.message);
            return null;
        }
    }

    // ===== VISUAL EFFECTS METHODS =====

    /**
     * Create visual effects for navmesh polygons
     */
    createNavMeshEffects(player, navMeshData) {
        const objectKey = `navmesh_${player.characterId}`;
        
        // Clear previous visualization
        this.clearVisualizationForPlayer(player);
        
        try {
            if (navMeshData.isFallback) {
                // Simple point-based visualization for fallback mode
                navMeshData.polygons.forEach((point, index) => {
                    this.createPointEffect(player, point.position, this.settings.navMeshColor, `${objectKey}_point_${index}`);
                });
            } else {
                // Full polygon visualization
                navMeshData.polygons.forEach((polygon, index) => {
                    this.createPolygonEffect(player, polygon, this.settings.navMeshColor, `${objectKey}_poly_${index}`);
                });
                
                navMeshData.edges.forEach((edge, index) => {
                    this.createLineEffect(player, edge.start, edge.end, this.settings.navMeshColor, `${objectKey}_edge_${index}`);
                });
            }
            
            // Store visualization for cleanup
            if (!this.visualizationObjects.has(player.characterId)) {
                this.visualizationObjects.set(player.characterId, new Set());
            }
            this.visualizationObjects.get(player.characterId).add(objectKey);
            
        } catch (error) {
            console.error(`[NavMeshVisualizer] Error creating navmesh effects:`, error);
        }
    }

    /**
     * Create visual marker for an agent
     */
    createAgentMarker(player, agentPos, npcId) {
        try {
            const markerPos = [
                agentPos.x || agentPos[0],
                (agentPos.y || agentPos[1]) + 2.0, // Raise marker above ground
                agentPos.z || agentPos[2]
            ];
            
            // Create a bright effect at agent position
            this.server.sendData(player, "Character.PlayWorldCompositeEffect", {
                characterId: player.characterId,
                effectId: 5343, // Bright muzzle flash effect
                position: new Float32Array([...markerPos, 1])
            });
            
            console.log(`[NavMeshVisualizer] Created agent marker for NPC ${npcId} at [${markerPos[0].toFixed(1)}, ${markerPos[1].toFixed(1)}, ${markerPos[2].toFixed(1)}]`);
            
        } catch (error) {
            console.warn(`[NavMeshVisualizer] Error creating agent marker:`, error.message);
        }
    }

    /**
     * Create path visualization
     */
    createPathVisualization(player, pathData, pathId) {
        try {
            if (!Array.isArray(pathData) || pathData.length === 0) return;
            
            const objectKey = `path_${pathId}_${player.characterId}`;
            
            pathData.forEach((waypoint, index) => {
                const pos = waypoint.position || waypoint;
                const effectPos = [
                    pos[0],
                    pos[1] + 1.5,
                    pos[2]
                ];
                
                let effectId = 1165; // Default effect
                
                // Different effects for different waypoint types
                if (waypoint.isStart || index === 0) {
                    effectId = 5180; // Green effect for start
                } else if (waypoint.isEnd || index === pathData.length - 1) {
                    effectId = 5181; // Red effect for end
                } else {
                    effectId = 99;   // Blue effect for waypoints
                }
                
                this.server.sendData(player, "Character.PlayWorldCompositeEffect", {
                    characterId: player.characterId,
                    effectId: effectId,
                    position: new Float32Array([...effectPos, 1])
                });
            });
            
            // Store for cleanup
            if (!this.visualizationObjects.has(player.characterId)) {
                this.visualizationObjects.set(player.characterId, new Set());
            }
            this.visualizationObjects.get(player.characterId).add(objectKey);
            
            console.log(`[NavMeshVisualizer] Created path visualization with ${pathData.length} waypoints`);
            
        } catch (error) {
            console.error(`[NavMeshVisualizer] Error creating path visualization:`, error);
        }
    }

    /**
     * Create a point effect
     */
    createPointEffect(player, position, color, objectId) {
        try {
            const effectPos = [
                position[0],
                position[1] + 0.5,
                position[2]
            ];
            
            // Use different effects based on color
            let effectId = 1165; // Default
            if (color === this.settings.navMeshColor) effectId = 5343;
            else if (color === this.settings.pathColor) effectId = 99;
            else if (color === this.settings.agentColor) effectId = 178;
            
            this.server.sendData(player, "Character.PlayWorldCompositeEffect", {
                characterId: player.characterId,
                effectId: effectId,
                position: new Float32Array([...effectPos, 1])
            });
            
        } catch (error) {
            console.warn(`[NavMeshVisualizer] Error creating point effect:`, error.message);
        }
    }

    /**
     * Create polygon visualization (simplified as points for H1Z1)
     */
    createPolygonEffect(player, polygon, color, objectId) {
        // Since H1Z1 doesn't support complex geometry rendering,
        // we'll represent polygons as corner points
        try {
            if (polygon.vertices && Array.isArray(polygon.vertices)) {
                polygon.vertices.forEach((vertex, index) => {
                    this.createPointEffect(player, vertex, color, `${objectId}_vertex_${index}`);
                });
            } else if (polygon.position) {
                this.createPointEffect(player, polygon.position, color, objectId);
            }
        } catch (error) {
            console.warn(`[NavMeshVisualizer] Error creating polygon effect:`, error.message);
        }
    }

    /**
     * Create line effect between two points
     */
    createLineEffect(player, startPos, endPos, color, objectId) {
        try {
            // Create effects at both endpoints and midpoint for line visualization
            this.createPointEffect(player, startPos, color, `${objectId}_start`);
            this.createPointEffect(player, endPos, color, `${objectId}_end`);
            
            // Create midpoint effect
            const midPoint = [
                (startPos[0] + endPos[0]) / 2,
                (startPos[1] + endPos[1]) / 2,
                (startPos[2] + endPos[2]) / 2
            ];
            this.createPointEffect(player, midPoint, color, `${objectId}_mid`);
            
        } catch (error) {
            console.warn(`[NavMeshVisualizer] Error creating line effect:`, error.message);
        }
    }

    // ===== CLEANUP METHODS =====

    /**
     * Clear all visualizations for a player
     */
    clearVisualizationForPlayer(player) {
        const playerId = player.characterId;
        
        if (this.visualizationObjects.has(playerId)) {
            // H1Z1 effects are temporary, so we just remove from tracking
            this.visualizationObjects.delete(playerId);
        }
        
        console.log(`[NavMeshVisualizer] Cleared visualizations for player ${playerId}`);
    }

    /**
     * Clear specific path visualization
     */
    clearPathVisualization(player, pathId) {
        const playerId = player.characterId;
        const objectKey = `path_${pathId}_${playerId}`;
        
        if (this.visualizationObjects.has(playerId)) {
            this.visualizationObjects.get(playerId).delete(objectKey);
        }
        
        console.log(`[NavMeshVisualizer] Cleared path visualization ${pathId} for player ${playerId}`);
    }

    /**
     * Update continuous visualizations
     */
    update() {
        const now = Date.now();
        
        if (now - this.lastVisualizationUpdate < this.updateInterval) {
            return;
        }
        
        this.lastVisualizationUpdate = now;
        
        // Update agent visualizations for all debug players
        for (const playerId of this.debugPlayers) {
            const player = this.server?.getClientByCharId?.(playerId);
            if (player && player.character && player.character.isAlive) {
                // Refresh agent paths if enabled
                if (this.visualizationObjects.has(playerId)) {
                    this.showAgentPaths(player);
                }
            } else {
                // Player disconnected or died, clean up
                this.debugPlayers.delete(playerId);
                this.visualizationObjects.delete(playerId);
            }
        }
    }

    /**
     * Cleanup when player disconnects
     */
    onPlayerDisconnect(playerId) {
        this.debugPlayers.delete(playerId);
        this.visualizationObjects.delete(playerId);
        console.log(`[NavMeshVisualizer] Cleaned up disconnected player ${playerId}`);
    }

    // ===== UTILITY METHODS =====

    /**
     * Send chat message to player
     */
    sendMessage(player, message) {
        if (this.server && this.server.sendChatText) {
            this.server.sendChatText(player, `[NavViz] ${message}`);
        } else {
            console.log(`[NavMeshVisualizer] ${player.characterId}: ${message}`);
        }
    }

    /**
     * Get visualization statistics
     */
    getStats() {
        return {
            activeDebugPlayers: this.debugPlayers.size,
            totalVisualizations: Array.from(this.visualizationObjects.values()).reduce((total, set) => total + set.size, 0),
            isEnabled: this.isEnabled,
            lastUpdate: this.lastVisualizationUpdate
        };
    }

    // ===== PLACEHOLDER METHODS FOR FUTURE IMPLEMENTATION =====
    
    /**
     * Extract tiles around position (placeholder)
     */
    extractTilesAroundPosition(navMesh, centerPos, radius) {
        // This would be implemented based on your specific recast-navigation API
        // For now, return empty array to trigger fallback visualization
        return [];
    }

    /**
     * Extract polygons from tile (placeholder)
     */
    extractPolygonsFromTile(tileData) {
        // Implementation would depend on tile data structure
        return [];
    }

    /**
     * Extract edges from tile (placeholder)
     */
    extractEdgesFromTile(tileData) {
        // Implementation would depend on tile data structure
        return [];
    }
}

module.exports = NavMeshVisualizer;