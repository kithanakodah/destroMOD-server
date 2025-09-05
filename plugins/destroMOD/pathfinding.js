// ======================================================================
// MODIFIED H1Z1-Server Compatible Pathfinding Module for destroMOD
// Using C++ 64-bit pathfinding service instead of WASM
// ENHANCED VERSION with zombie stopping fixes
// ======================================================================

"use strict";

const path = require('path');
const serverModulePath = path.join(process.cwd(), 'node_modules/h1z1-server');
const { getCurrentServerTimeWrapper, getDistance } = require(path.join(serverModulePath, 'out/utils/utils'));

class PathfindingManager {
    constructor(plugin) {
        this.plugin = plugin;
        this.isReady = false;
        
        // Enhanced agent tracking
        this.maxAgents = 50;
        this.agents = new Map(); // npcId -> { addedAt, lastUsed, forceStopped }
        this.server = null;

        // Track aggro states
        this.aggroedNPCs = new Set();
        
        this.pathfindingStats = {
            pathsCalculated: 0,
            activeAgents: 0,
            crowdUpdates: 0,
            aggroAdditions: 0,
            aggroRemovals: 0,
            cleanupOperations: 0,
            slotRecycles: 0,
            forceStops: 0,
            targetReached: 0
        };

        // Cleanup intervals
        this._lastCleanupTime = 0;
        this._cleanupInterval = 300000; // Every 300 seconds
        
        // C++ service URL
        this.serviceUrl = 'http://localhost:8080';
    }

    setServer(server) {
        this.server = server;
    }

    async initialize() {
        console.log(`[${this.plugin.name}] Initializing 64-bit pathfinding service...`);
        try {
            // Test connection to C++ service
            const response = await fetch(`${this.serviceUrl}/health`);
            if (response.ok) {
                console.log(`[${this.plugin.name}] Connected to 64-bit C++ pathfinding service`);
            } else {
                throw new Error('Service not responding');
            }
        } catch (error) {
            console.error(`[${this.plugin.name}] Failed to connect to C++ pathfinding service:`, error.message);
            console.error(`[${this.plugin.name}] Make sure the C++ service is running on port 8080`);
            return false;
        }
        
        this.isReady = true;
        console.log(`[${this.plugin.name}] 64-bit pathfinding system ready!`);
        
        this.startCleanup();
        return true;
    }

    // Helper methods - no longer needed but kept for compatibility
    static Float32ToVec3(f) {
        return { x: f[0], y: f[1], z: f[2] };
    }

    static Vec3ToFloat32(v) {
        return new Float32Array([v.x, v.y, v.z]);
    }

    Float32ToVec3(f) { return PathfindingManager.Float32ToVec3(f); }
    Vec3ToFloat32(v) { return PathfindingManager.Vec3ToFloat32(v); }

    // MODIFIED: Use C++ service for line of sight
    async hasLineOfSight(fromPos, toPos) {
        if (!this.isReady) return true; // Default to true if service not ready
        
        try {
            const response = await fetch(`${this.serviceUrl}/hasLineOfSight`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    start: [fromPos[0], fromPos[1], fromPos[2]],
                    end: [toPos[0], toPos[1], toPos[2]]
                })
            });
            
            const result = await response.json();
            return result.success ? result.hasLineOfSight : true;
        } catch (error) {
            console.warn(`[${this.plugin.name}] Line of sight check failed:`, error.message);
            return true; // Default to true on error
        }
    }

    // MODIFIED: Use C++ service for closest nav point
    async getClosestNavPoint(pos) {
        if (!this.isReady) return null;
        
        try {
            const response = await fetch(`${this.serviceUrl}/getClosestNavPoint`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    x: pos[0],
                    y: pos[1], 
                    z: pos[2]
                })
            });
            
            const result = await response.json();
            if (result.success && result.point) {
                return {
                    x: result.point.x,
                    y: result.point.y,
                    z: result.point.z
                };
            }
        } catch (error) {
            console.warn(`[${this.plugin.name}] Get closest nav point failed:`, error.message);
        }
        
        return null;
    }

    startCleanup() {
        setInterval(() => {
            this.cleanup();
        }, this._cleanupInterval);
        
        console.log(`[${this.plugin.name}] Cleanup system started`);
    }

    cleanup() {
        const now = Date.now();
        if (now - this._lastCleanupTime < this._cleanupInterval) return;
        
        this._lastCleanupTime = now;
        this.pathfindingStats.cleanupOperations++;
        
        console.log(`[${this.plugin.name}] Running cleanup...`);
        
        const agentsToRemove = [];
        
        // Check for dead/invalid NPCs
        for (const [npcId, agentData] of this.agents.entries()) {
            const npc = this.server?._npcs[npcId];
            
            if (!npc || !npc.isAlive || !this.aggroedNPCs.has(npcId)) {
                agentsToRemove.push(npcId);
                continue;
            }
        }
        
        // Remove invalid agents
        for (const npcId of agentsToRemove) {
            this.removeAgentFromCrowd(npcId);
        }
        
        if (agentsToRemove.length > 0) {
            console.log(`[${this.plugin.name}] Cleaned up ${agentsToRemove.length} invalid agents`);
        }
        
        this.pathfindingStats.activeAgents = this.agents.size;
    }

    // MODIFIED: Use C++ service for agent addition
    async addAggroedNPC(npc) {
        if (!this.isReady || this.agents.has(npc.characterId)) {
            return false;
        }

        // Check if we have space
        if (this.agents.size >= this.maxAgents) {
            console.log(`[${this.plugin.name}] No free slots available for NPC ${npc.characterId}`);
            return false;
        }

        // Mark as aggroed
        this.aggroedNPCs.add(npc.characterId);

        try {
            // Get navmesh position from C++ service
            const position = await this.getClosestNavPoint(npc.state.position);
            if (!position) {
                console.log(`[${this.plugin.name}] No valid nav position for NPC ${npc.characterId}`);
                this.aggroedNPCs.delete(npc.characterId);
                return false;
            }

            // Update NPC position to navmesh
            npc.state.position[0] = position.x;
            npc.state.position[1] = position.y;
            npc.state.position[2] = position.z;

            // Add agent to C++ service
            const response = await fetch(`${this.serviceUrl}/addAggroedNPC`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    npcId: npc.characterId,
                    x: position.x,
                    y: position.y,
                    z: position.z
                })
            });

            const result = await response.json();
            if (result.success) {
                const now = Date.now();
                
                this.agents.set(npc.characterId, {
                    addedAt: now,
                    lastUsed: now,
                    forceStopped: false
                });
                
                // Mark NPC as crowd-managed
                npc._crowdAgent = true;
                npc._isAggroed = true;
                npc.wasAggroed = true;
                
                this.pathfindingStats.aggroAdditions++;
                console.log(`[${this.plugin.name}] Added NPC ${npc.characterId} to 64-bit crowd (${this.agents.size}/${this.maxAgents})`);
                return true;
            } else {
                console.log(`[${this.plugin.name}] Failed to add agent for NPC ${npc.characterId}`);
                this.aggroedNPCs.delete(npc.characterId);
                return false;
            }

        } catch (error) {
            console.error(`[${this.plugin.name}] Exception adding NPC ${npc.characterId}:`, error);
            this.aggroedNPCs.delete(npc.characterId);
            return false;
        }
    }

    // MODIFIED: Use C++ service for agent removal
    async removeAggroedNPC(npc) {
        const npcId = npc.characterId;
        
        // Remove from aggro tracking
        this.aggroedNPCs.delete(npcId);
        
        if (this.agents.has(npcId)) {
            await this.removeAgentFromCrowd(npcId);
            
            // Clean up NPC flags
            npc._crowdAgent = false;
            npc._isAggroed = false;
            npc.wasAggroed = false;
            
            this.pathfindingStats.aggroRemovals++;
            console.log(`[${this.plugin.name}] Removed de-aggroed NPC ${npcId} from 64-bit crowd (${this.agents.size}/${this.maxAgents})`);
        }
    }

    async removeAgentFromCrowd(npcId) {
        if (!this.agents.has(npcId)) return;

        try {
            await fetch(`${this.serviceUrl}/removeAggroedNPC`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ npcId: npcId })
            });
            
            this.agents.delete(npcId);
            this.pathfindingStats.activeAgents = this.agents.size;
            
        } catch (error) {
            console.warn(`[${this.plugin.name}] Error removing agent for NPC ${npcId}:`, error.message);
        }
    }

    // MODIFIED: Use C++ service for setting targets
    async setNPCTarget(npcId, targetPosition) {
        if (!this.isReady || !this.agents.has(npcId)) return false;

        try {
            // CRITICAL: Validate target position to prevent NaN
            if (!targetPosition || 
                !Array.isArray(targetPosition) || 
                targetPosition.length < 3 ||
                !Number.isFinite(targetPosition[0]) ||
                !Number.isFinite(targetPosition[1]) ||
                !Number.isFinite(targetPosition[2])) {
                console.warn(`[${this.plugin.name}] Invalid target position for NPC ${npcId}:`, targetPosition);
                return false;
            }
            
            const agentData = this.agents.get(npcId);
            agentData.lastUsed = Date.now();
            agentData.forceStopped = false; // Clear force stop flag when setting new target
            
            const response = await fetch(`${this.serviceUrl}/setNPCTarget`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    npcId: npcId,
                    target: [targetPosition[0], targetPosition[1], targetPosition[2]]
                })
            });

            const result = await response.json();
            if (result.success) {
                this.pathfindingStats.pathsCalculated++;
                return true;
            }
            
            return false;

        } catch (error) {
            console.warn(`[${this.plugin.name}] Error setting target for NPC ${npcId}:`, error.message);
            return false;
        }
    }

    async stopNPC(npcId) {
        if (!this.isReady || !this.agents.has(npcId)) return;
        
        try {
            await fetch(`${this.serviceUrl}/stopNPC`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ npcId: npcId })
            });
            
            const agentData = this.agents.get(npcId);
            if (agentData) {
                agentData.lastUsed = Date.now();
            }
        } catch (error) {
            console.warn(`[${this.plugin.name}] Error stopping NPC ${npcId}:`, error.message);
        }
    }

    // NEW: Force stop with immediate velocity zeroing
    async forceStopNPC(npcId) {
        if (!this.isReady || !this.agents.has(npcId)) return;
        
        try {
            // Send force stop with brake parameter
            await fetch(`${this.serviceUrl}/forceStopNPC`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    npcId: npcId,
                    brakeForce: 10.0 // High brake force for immediate stop
                })
            });
            
            const agentData = this.agents.get(npcId);
            if (agentData) {
                agentData.lastUsed = Date.now();
                agentData.forceStopped = true; // Mark as force stopped
            }
            
            this.pathfindingStats.forceStops++;
            console.log(`[${this.plugin.name}] Force stopped NPC ${npcId} with brake force`);
        } catch (error) {
            console.warn(`[${this.plugin.name}] Error force stopping NPC ${npcId}:`, error.message);
        }
    }

    // NEW: Check if agent has reached target (for callback mechanism)
    async checkAgentTargetReached(npcId) {
        if (!this.isReady || !this.agents.has(npcId)) return false;
        
        try {
            const response = await fetch(`${this.serviceUrl}/isAgentAtTarget`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ npcId: npcId })
            });
            
            const result = await response.json();
            if (result.success && result.atTarget) {
                this.pathfindingStats.targetReached++;
                return true;
            }
            return false;
        } catch (error) {
            console.warn(`[${this.plugin.name}] Error checking target reached for NPC ${npcId}:`, error.message);
            return false;
        }
    }

    // MODIFIED: Enhanced update method with dead NPC handling
async update(deltaTime) {
    if (!this.isReady || !this.server) return;

    this.pathfindingStats.crowdUpdates++;

    const now = Date.now();
    for (const [npcId, agentData] of this.agents.entries()) {
        const npc = this.server._npcs[npcId];
        
        // NEW: Skip position updates for dead NPCs to prevent momentum/ragdolling
        if (!npc || !npc.isAlive) {
            // Clean up dead agents but don't update their positions
            this.removeAgentFromCrowd(npcId);
            continue;
        }

        try {
            agentData.lastUsed = now;

            // NEW: Check if agent reached target before position update
            if (!agentData.forceStopped) {
                const reachedTarget = await this.checkAgentTargetReached(npcId);
                if (reachedTarget) {
                    console.log(`[${this.plugin.name}] NPC ${npcId} reached pathfinding target`);
                    await this.forceStopNPC(npcId);
                    
                    // Trigger state change if NPC should be attacking
                    if (npc.aiState === 'CHASING') {
                        const aiManager = this.server.aiManager;
                        if (aiManager.playerEntities) {
                            const closestPlayer = this.findClosestPlayerForNPC(npc, aiManager);
                            if (closestPlayer) {
                                const distance = this.getDistance(npc.state.position, closestPlayer.state.position);
                                const attackRadius = npc.personalAttackRadius || 1.8;
                                if (distance <= attackRadius) {
                                    // Trigger attack state through AI system
                                    if (npc.aiType === 'ZOMBIE') {
                                        this.server.destroMOD.humanAI.changeZombieState(npc, 'ATTACKING');
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Get agent position and velocity from C++ service
            const [posResponse, velResponse] = await Promise.all([
                fetch(`${this.serviceUrl}/getAgentPosition`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ npcId: npcId })
                }),
                fetch(`${this.serviceUrl}/getAgentVelocity`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ npcId: npcId })
                })
            ]);

            const posResult = await posResponse.json();
            const velResult = await velResponse.json();

            if (posResult.success && posResult.position) {
                // Update NPC position directly from crowd
                npc.state.position[0] = posResult.position[0];
                npc.state.position[1] = posResult.position[1];
                npc.state.position[2] = posResult.position[2];
                
                // Calculate movement orientation and speed
                let horizontalSpeed = 0;
                let orientation = npc.state.orientation;
                
                if (velResult.success && velResult.velocity) {
                    const vel = velResult.velocity;
                    horizontalSpeed = Math.sqrt(vel[0] * vel[0] + vel[2] * vel[2]);
                    if (horizontalSpeed > 0.1) {
                        orientation = Math.atan2(vel[0], vel[2]);
                    }
                }

                // Don't send movement if force stopped
                if (!agentData.forceStopped) {
                    this.sendMovementPacket(npc, orientation, horizontalSpeed);
                }
            }
        } catch (error) {
            console.warn(`[${this.plugin.name}] Error updating agent for NPC ${npcId}:`, error.message);
        }
    }
}

    // Helper method for finding closest player (used in update)
    findClosestPlayerForNPC(npc, aiManager) {
        if (!aiManager.playerEntities) return null;
        
        let closestPlayer = null;
        let minDistance = Infinity;
        
        aiManager.playerEntities.forEach((player) => {
            if (!player.isAlive) return;
            const distance = this.getDistance(npc.state.position, player.state.position);
            if (distance < minDistance) {
                minDistance = distance;
                closestPlayer = player;
            }
        });
        
        return closestPlayer;
    }

    // Helper method for distance calculation
    getDistance(pos1, pos2) {
        const dx = pos1[0] - pos2[0];
        const dy = pos1[1] - pos2[1];
        const dz = pos1[2] - pos2[2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    sendMovementPacket(npc, orientation, speed) {
        if (!this.server) return;
        npc.lastSentSpeed = speed;
        npc.state.orientation = orientation;
        this.server.sendDataToAllWithSpawnedEntity(this.server._npcs, npc.characterId, "PlayerUpdatePosition", {
            transientId: npc.transientId,
            positionUpdate: {
                sequenceTime: getCurrentServerTimeWrapper().getTruncatedU32(),
                position: npc.state.position,
                unknown3_int8: 0,
                stance: 66565,
                engineRPM: 0,
                orientation: orientation,
                frontTilt: 0,
                sideTilt: 0,
                angleChange: 0,
                verticalSpeed: 0,
                horizontalSpeed: speed
            }
        });
    }

    getStats() {
        return {
            isReady: this.isReady,
            crowdAgents: this.agents.size,
            aggroedNPCs: this.aggroedNPCs.size,
            maxCapacity: this.maxAgents,
            pathsCalculated: this.pathfindingStats.pathsCalculated,
            crowdUpdates: this.pathfindingStats.crowdUpdates,
            forceStops: this.pathfindingStats.forceStops,
            targetReached: this.pathfindingStats.targetReached
        };
    }

    getCrowdInfo() {
        if (!this.isReady) return null;
        
        return {
            totalCapacity: this.maxAgents,
            agentCount: this.agents.size,
            aggroedNPCs: this.aggroedNPCs.size,
            freeSlots: this.maxAgents - this.agents.size
        };
    }

    // MODIFIED: Use C++ service for path testing
    async testNavMesh(a, b) {
        console.log(`[TESTNAVMESH_DEBUG] Function called - C++ SERVICE VERSION`);
        if (!this.isReady) return [];
        
        try {
            const response = await fetch(`${this.serviceUrl}/testNavMesh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    start: [a[0], a[1], a[2]],
                    end: [b[0], b[1], b[2]]
                })
            });

            const result = await response.json();
            if (result.success && result.path && result.path.length > 0) {
                console.log(`[${this.plugin.name}] 64-bit path found with ${result.path.length} waypoints`);
                return result.path.map(point => new Float32Array([point[0], point[1], point[2]]));
            } else {
                console.warn(`[${this.plugin.name}] 64-bit path computation failed`);
                return [];
            }
            
        } catch (e) {
            console.error(`[${this.plugin.name}] testNavMesh C++ service error:`, e);
            return [];
        }
    }
}

module.exports = PathfindingManager;