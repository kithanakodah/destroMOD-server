"use strict";

const path = require('path');
const serverModulePath = path.join(process.cwd(), 'node_modules/h1z1-server');
const { getDistance, getCurrentServerTimeWrapper, randomIntFromInterval } = require(path.join(serverModulePath, 'out/utils/utils'));
const { Npc } = require(path.join(serverModulePath, 'out/servers/ZoneServer2016/entities/npc'));
const { ProjectileEntity } = require(path.join(serverModulePath, 'out/servers/ZoneServer2016/entities/projectileentity'));
const { MeleeTypes } = require(path.join(serverModulePath, 'out/servers/ZoneServer2016/models/enums'));

class ZombieAI {
    constructor(plugin) {
        this.plugin = plugin;
        this.debugMode = false;
        this.zombieCount = 0;
        
        // Animation thresholds based on your actual movement speeds
        this.IDLE_SPEED_THRESHOLD = 0.5;
        this.WALK_SPEED_THRESHOLD = 1.0;
        this.RUN_SPEED_THRESHOLD = 4.0
    }

    startup(server) {
        console.log(`[${this.plugin.name}] Starting Zombie AI initialization...`);
        const aiManager = server.aiManager;
        if (!aiManager) return console.error(`[${this.plugin.name}] FATAL: Could not find AIManager.`);

        if (!aiManager.npcEntities) {
            aiManager.npcEntities = new Set();
        }
        
        // This patch is now centrally handled in humanAI.js to avoid race conditions.
        // If humanAI hasn't loaded, this will set up a basic version.
        if (!aiManager.originalAddEntity) {
            console.log(`[${this.plugin.name}] Setting up zombie AI addEntity (human AI not loaded yet)`);
            
            const originalAddEntity = aiManager.addEntity.bind(aiManager);
            aiManager.originalAddEntity = originalAddEntity;
            
            aiManager.addEntity = (entity) => {
                if (entity instanceof Npc) {
                    if (entity.isHumanNPC !== true) {
                        aiManager.npcEntities.add(entity);
                        
                        // Initialize velocity tracking for animations
                        entity.velocity = { x: 0, y: 0, z: 0 };
                        entity.currentAnimation = 'Idle';
                        entity.lastAnimationUpdate = 0;
                        
                        entity.personalAttackRadius = this.plugin.ATTACK_RADIUS_MIN + Math.random() * (this.plugin.ATTACK_RADIUS_MAX - this.plugin.ATTACK_RADIUS_MIN);
                        entity.personalAggroRadius = this.plugin.AGGRO_RADIUS_MIN + Math.random() * (this.plugin.AGGRO_RADIUS_MAX - this.plugin.AGGRO_RADIUS_MIN);
                        entity.personalMoveSpeed = this.plugin.MOVE_SPEED_MIN + Math.random() * (this.plugin.MOVE_SPEED_MAX - this.plugin.MOVE_SPEED_MIN);
                        
                        entity.aiType = 'ZOMBIE';
                        this.zombieCount++;
                        
                        if (this.zombieCount % 50 === 0) {
                            console.log(`[${this.plugin.name}] Configured ${this.zombieCount} zombie NPCs...`);
                        }
                    }
                }
                originalAddEntity(entity);
            };
        } else {
            console.log(`[${this.plugin.name}] Human AI already set up addEntity, zombie AI will cooperate`);
        }
        
        console.log(`[${this.plugin.name}] Zombie AI addEntity setup complete.`);

        setTimeout(() => {
            console.log(`[${this.plugin.name}] Zombie AI fully active with ${this.zombieCount} zombie NPCs configured.`);
        }, 2000);
    }

    // Calculate horizontal speed from velocity (for animations)
    horizontalSpeed(vel) {
        if (!vel) return 0;
        return Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    }

    // Update animation based on actual movement velocity
    updateAnimationBasedOnVelocity(npc) {
        if (!npc.velocity) return;
        
        const now = Date.now();
        if (npc.lastAnimationUpdate && now - npc.lastAnimationUpdate < 200) return;
        
        const hSpeed = this.horizontalSpeed(npc.velocity);
        let newAnimation;
        
        if (npc.aiState === 'ATTACKING') {
            newAnimation = 'GrappleTell';
        } else if (hSpeed < this.IDLE_SPEED_THRESHOLD) {
            newAnimation = 'Idle';
        } else if (hSpeed < this.RUN_SPEED_THRESHOLD) {
            newAnimation = 'walk';
        } else {
            newAnimation = 'Run';
        }
        
        // --- THIS IS THE KEY CHANGE ---
        // Only log when the animation state actually changes.
        if (npc.currentAnimation !== newAnimation) {
            console.log(`[ANIMATION] NPC ${npc.characterId} state changed: ${npc.currentAnimation} -> ${newAnimation} (Speed: ${hSpeed.toFixed(2)}, AI State: ${npc.aiState})`);
            
            npc.currentAnimation = newAnimation;
            npc.playAnimation(newAnimation);
            npc.lastAnimationUpdate = now;
        }
    }

    alertNearbyZombies(enragedZombie, server) {
        const aiManager = server.aiManager;
        const plugin = this.plugin;

        if (!this.hasLoggedAlert || this.hasLoggedAlert < 3) {
            console.log(`[${plugin.name}] Enraged zombie ${enragedZombie.characterId} is alerting other zombies within ${plugin.ALERT_RADIUS} units.`);
            this.hasLoggedAlert = (this.hasLoggedAlert || 0) + 1;
        }

        if (aiManager.npcEntities) {
            let alertedCount = 0;
            aiManager.npcEntities.forEach((otherNpc) => {
                if (otherNpc.characterId === enragedZombie.characterId || !otherNpc.isAlive || otherNpc.isHumanNPC === true) {
                    return;
                }

                const distance = getDistance(enragedZombie.state.position, otherNpc.state.position);

                if (distance <= plugin.ALERT_RADIUS) {
                    const newAggroRadius = plugin.ALERTED_AGGRO_RADIUS_MIN + Math.random() * (plugin.ALERTED_AGGRO_RADIUS_MAX - plugin.ALERTED_AGGRO_RADIUS_MIN);
                    
                    if (otherNpc.personalAggroRadius < newAggroRadius) {
                        otherNpc.personalAggroRadius = newAggroRadius;
                        alertedCount++;
                    }
                }
            });
            
            if (alertedCount > 0 && (!this.hasLoggedAlertSummary || this.hasLoggedAlertSummary < 2)) {
                console.log(`[${plugin.name}] Zombie ${enragedZombie.characterId} alerted ${alertedCount} nearby zombies`);
                this.hasLoggedAlertSummary = (this.hasLoggedAlertSummary || 0) + 1;
            }
        }
    }

    runAiTick(aiManager) {
    if (!aiManager.npcEntities) return;

    aiManager.npcEntities.forEach((npc) => {
        try {
            if (!npc || !npc.state || npc.isHumanNPC === true) return;
            
            if (npc.aiState === undefined) npc.aiState = 'IDLE';
            
            if (!npc.isAlive) {
                if (npc.aiState !== 'IDLE') this.changeState(npc, 'IDLE');
                return;
            }
            
            const closestPlayer = this.findClosestPlayer(npc, aiManager);
            const newState = this.determineState(npc, closestPlayer);
            
            if (npc.aiState !== newState) { 
                this.changeState(npc, newState); 
            }
            
            this.executeContinuousAction(npc, closestPlayer);
            
            // ONLY update animations for aggroed NPCs (those in pathfinding crowd)
            if (npc.wasAggroed && this.plugin.pathfinding?.agents?.has(npc.characterId)) {
                console.log(`[DEBUG] About to update animation for AGGROED NPC ${npc.characterId}`);
                this.updateAnimationBasedOnVelocity(npc);
            } else {
                // For non-aggroed zombies, use simple state-based animations
                if (npc.aiState === 'ATTACKING') {
                    if (npc.currentAnimation !== 'GrappleTell') {
                        npc.currentAnimation = 'GrappleTell';
                        npc.playAnimation('GrappleTell');
                    }
                } else if (npc.aiState === 'CHASING') {
                    if (npc.currentAnimation !== 'walk') {
                        npc.currentAnimation = 'walk';
                        npc.playAnimation('walk');
                    }
                } else {
                    if (npc.currentAnimation !== 'Idle') {
                        npc.currentAnimation = 'Idle';
                        npc.playAnimation('Idle');
                    }
                }
            }
            
        } catch (e) {
            if (this.debugMode) {
                console.error(`[${this.plugin.name}] Zombie AI tick failed for NPC ${npc.characterId || 'UNKNOWN'}:`, e);
            }
        }
    });
}

    changeState(npc, newState) {
        const oldState = npc.aiState || 'IDLE';
        if (oldState === newState) return;
        
        npc.aiState = newState;
        
        // Set initial animations for state changes
        // The velocity-based system will override these if needed
        switch (newState) {
            case 'IDLE': 
                this.executeStop(npc); 
               // npc.currentAnimation = 'Idle';
               // npc.playAnimation("Idle"); 
                break;
            case 'ATTACKING': 
                this.executeStop(npc, true); // Allow slow movement while attacking
                // npc.currentAnimation = 'GrappleTell';
                // Don't play animation here - let the attack method handle it
                break;
            case 'CHASING': 
                // Let velocity-based animation system handle this
                break;
        }
    }

    executeContinuousAction(npc, target) {
        if (npc.aiState === 'CHASING' && target) { 
            this.executeMovement(npc, target); 
        }
        if (npc.aiState === 'ATTACKING' && target) { 
            this.tryAttack(npc, target); 
        }
    }

    executeMovement(npc, target) {
        if (!target) {
            this.executeStop(npc);
            return;
        }

        if (this.plugin.pathfinding && this.plugin.pathfinding.isReady) {
            if (this.plugin.pathfinding.agents && this.plugin.pathfinding.agents.has(npc.characterId)) {
                const now = Date.now();
                if (!npc.lastPathfindTime || now - npc.lastPathfindTime > 100) { // changed to 200ms, may need to lower a bit
                    npc.lastPathfindTime = now;
                    this.plugin.pathfinding.setNPCTarget(npc.characterId, target.state.position);
                }
            }
        }
    }

    tryAttack(npc, target) {
    const now = Date.now();
    const canAttackAt = this.plugin.attackCooldowns.get(npc.characterId) || 0;
    
    if (now < canAttackAt) return;

    // === DEBUG LOGGING ===
    console.log(`\n[ATTACK_DEBUG] ==================== NPC ${npc.characterId} Attack Attempt ====================`);
    console.log(`[ATTACK_DEBUG] Timestamp: ${new Date(now).toISOString()}`);
    console.log(`[ATTACK_DEBUG] NPC Position: [${npc.state.position[0].toFixed(3)}, ${npc.state.position[1].toFixed(3)}, ${npc.state.position[2].toFixed(3)}]`);
    console.log(`[ATTACK_DEBUG] NPC AI State: ${npc.aiState}`);

    // Debug the target parameter (potentially stale)
    if (target && target.state && target.state.position) {
        console.log(`[ATTACK_DEBUG] Target param position: [${target.state.position[0].toFixed(3)}, ${target.state.position[1].toFixed(3)}, ${target.state.position[2].toFixed(3)}]`);
        console.log(`[ATTACK_DEBUG] Target characterId: ${target.characterId}`);
        
        const distanceToTargetParam = getDistance(npc.state.position, target.state.position);
        console.log(`[ATTACK_DEBUG] Distance to target param: ${distanceToTargetParam.toFixed(3)}`);
    } else {
        console.log(`[ATTACK_DEBUG] ERROR: Invalid target parameter:`, target);
        return;
    }

    // CRITICAL FIX: Get fresh client and position data
    const client = npc.server.getClientByCharId(target.characterId);
    if (!client) {
        console.log(`[ATTACK_DEBUG] ERROR: Could not find client for characterId ${target.characterId}`);
        return;
    }

    if (!client.character || !client.character.state || !client.character.state.position) {
        console.log(`[ATTACK_DEBUG] ERROR: Client character has invalid state`);
        return;
    }

    const freshPlayerPosition = client.character.state.position;
    console.log(`[ATTACK_DEBUG] Fresh player position: [${freshPlayerPosition[0].toFixed(3)}, ${freshPlayerPosition[1].toFixed(3)}, ${freshPlayerPosition[2].toFixed(3)}]`);
    
    // Add this right after getting the fresh player position:
    console.log(`[ATTACK_DEBUG] Server thinks player is at: [${freshPlayerPosition[0].toFixed(3)}, ${freshPlayerPosition[1].toFixed(3)}, ${freshPlayerPosition[2].toFixed(3)}]`);
    console.log(`[ATTACK_DEBUG] Attack happening at timestamp: ${Date.now()}`);
    
    // Also log the last time this player's position was updated
    if (client.character.lastPositionUpdate) {
        const positionAge = now - client.character.lastPositionUpdate;
        console.log(`[ATTACK_DEBUG] Player position is ${positionAge}ms old`);
    } else {
        console.log(`[ATTACK_DEBUG] No lastPositionUpdate timestamp found`);
    }
    
    // Calculate position differences to see staleness
    const positionDrift = [
        Math.abs(target.state.position[0] - freshPlayerPosition[0]),
        Math.abs(target.state.position[1] - freshPlayerPosition[1]),
        Math.abs(target.state.position[2] - freshPlayerPosition[2])
    ];
    const totalDrift = Math.sqrt(positionDrift[0] * positionDrift[0] + positionDrift[1] * positionDrift[1] + positionDrift[2] * positionDrift[2]);
    
    console.log(`[ATTACK_DEBUG] Position drift X: ${positionDrift[0].toFixed(3)}, Y: ${positionDrift[1].toFixed(3)}, Z: ${positionDrift[2].toFixed(3)}`);
    console.log(`[ATTACK_DEBUG] Total position drift: ${totalDrift.toFixed(3)} units`);
    
    if (totalDrift > 2.0) {
        console.log(`[ATTACK_DEBUG] ⚠️ WARNING: Significant position drift detected! Target param is ${totalDrift.toFixed(3)} units behind actual player position`);
    }

    // Distance calculations
    const distanceToFreshPosition = getDistance(npc.state.position, freshPlayerPosition);
    const distanceToTargetParam = getDistance(npc.state.position, target.state.position);
    
    console.log(`[ATTACK_DEBUG] Distance to fresh position: ${distanceToFreshPosition.toFixed(3)}`);
    console.log(`[ATTACK_DEBUG] Distance to target param: ${distanceToTargetParam.toFixed(3)}`);
    console.log(`[ATTACK_DEBUG] Distance difference: ${Math.abs(distanceToFreshPosition - distanceToTargetParam).toFixed(3)}`);

    // Attack radius validation
    const attackRadius = npc.personalAttackRadius || this.plugin.ATTACK_RADIUS_MAX;
    const effectiveAttackRadius = attackRadius + 0.5; // Buffer for latency
    
    console.log(`[ATTACK_DEBUG] Personal attack radius: ${attackRadius.toFixed(3)}`);
    console.log(`[ATTACK_DEBUG] Effective attack radius (with buffer): ${effectiveAttackRadius.toFixed(3)}`);

    // Check both distances for comparison
    const canAttackTargetParam = distanceToTargetParam <= effectiveAttackRadius;
    const canAttackFreshPosition = distanceToFreshPosition <= effectiveAttackRadius;
    
    console.log(`[ATTACK_DEBUG] Can attack target param position: ${canAttackTargetParam}`);
    console.log(`[ATTACK_DEBUG] Can attack fresh position: ${canAttackFreshPosition}`);

    // CRITICAL FIX: Use fresh position for the actual attack decision
    if (distanceToFreshPosition > effectiveAttackRadius) {
        console.log(`[ATTACK_DEBUG] ❌ ATTACK CANCELLED: Player moved out of range since attack state was triggered`);
        console.log(`[ATTACK_DEBUG] Fresh distance (${distanceToFreshPosition.toFixed(3)}) > effective radius (${effectiveAttackRadius.toFixed(3)})`);
        
        // Log if we would have attacked using the stale position
        if (canAttackTargetParam) {
            console.log(`[ATTACK_DEBUG] 🚨 STALE POSITION WOULD HAVE CAUSED FALSE ATTACK! Target param was in range but fresh position is not.`);
        }
        
        console.log(`[ATTACK_DEBUG] ==================== Attack Cancelled ====================\n`);
        return;
    }

    // Set attack cooldown
    const randomCooldown = randomIntFromInterval(this.plugin.ATTACK_COOLDOWN_MIN_MS, this.plugin.ATTACK_COOLDOWN_MAX_MS);
    this.plugin.attackCooldowns.set(npc.characterId, now + randomCooldown);
    
    console.log(`[ATTACK_DEBUG] ✅ ATTACK PROCEEDING: Setting cooldown of ${randomCooldown}ms`);
    console.log(`[ATTACK_DEBUG] Next attack available at: ${new Date(now + randomCooldown).toISOString()}`);

    // Face the FRESH position, not the stale target
    const freshTarget = { 
        state: { 
            position: freshPlayerPosition 
        },
        characterId: target.characterId
    };
    
    this.faceTarget(npc, freshTarget);
    console.log(`[ATTACK_DEBUG] NPC facing fresh target position`);
    
    // Play attack animation
    npc.currentAnimation = 'GrappleTell';
    npc.playAnimation("GrappleTell");
    console.log(`[ATTACK_DEBUG] Playing GrappleTell animation`);
    
    // FINAL VALIDATION: Check fresh position one more time right before damage
    const finalDistance = getDistance(npc.state.position, freshPlayerPosition);
    console.log(`[ATTACK_DEBUG] Final distance check: ${finalDistance.toFixed(3)}`);
    
    if (finalDistance <= effectiveAttackRadius) {
        console.log(`[ATTACK_DEBUG] 🗡️ APPLYING DAMAGE to player at fresh position`);
        
        // Apply damage using FRESH position data
        client.character.OnMeleeHit(npc.server, {
            entity: npc.characterId, 
            weapon: 0, 
            damage: npc.npcMeleeDamage, 
            causeBleed: false, 
            meleeType: MeleeTypes.FISTS,
            hitReport: { 
                sessionProjectileCount: 0, 
                characterId: target.characterId, 
                position: freshPlayerPosition, // CRITICAL: Use fresh position, not stale target.state.position
                unknownFlag1: 0, 
                unknownByte2: 0, 
                totalShotCount: 0, 
                hitLocation: "TORSO" 
            }
        });
        
        console.log(`[ATTACK_DEBUG] Damage applied: ${npc.npcMeleeDamage} to character ${target.characterId}`);
        console.log(`[ATTACK_DEBUG] Hit report position: [${freshPlayerPosition[0].toFixed(3)}, ${freshPlayerPosition[1].toFixed(3)}, ${freshPlayerPosition[2].toFixed(3)}]`);
        
        // Log successful attack for main console (keep existing debug counter)
        if (!this.hasLoggedAttack || this.hasLoggedAttack < 3) {
            console.log(`[${this.plugin.name}] Zombie ${npc.characterId} attacked ${target.characterId} for ${npc.npcMeleeDamage} damage`);
            this.hasLoggedAttack = (this.hasLoggedAttack || 0) + 1;
        }
        
    } else {
        console.log(`[ATTACK_DEBUG] ❌ FINAL CHECK FAILED: Player moved out of range during attack execution`);
        console.log(`[ATTACK_DEBUG] Final distance (${finalDistance.toFixed(3)}) > effective radius (${effectiveAttackRadius.toFixed(3)})`);
    }
    
    console.log(`[ATTACK_DEBUG] ==================== Attack Complete ====================\n`);
}

    executeStop(npc, allowSlowMovement = false) {
        if (this.plugin.pathfinding && this.plugin.pathfinding.isReady) {
            if (this.plugin.pathfinding.agents && this.plugin.pathfinding.agents.has(npc.characterId)) {
                if (allowSlowMovement) {
                    // Don't completely stop, just slow down significantly
                    // This could be implemented in pathfinding service
                } else {
                    this.plugin.pathfinding.stopNPC(npc.characterId);
                }
            }
        }
        
        // Let the pathfinding system handle movement packets
        // Don't override with manual movement packets here
    }

    sendMovementPacket(npc, orientation, speed, verticalSpeed = 0) {
        npc.lastSentSpeed = speed;
        npc.state.orientation = orientation;
        npc.server.sendDataToAllWithSpawnedEntity(npc.server._npcs, npc.characterId, "PlayerUpdatePosition", {
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
                verticalSpeed: verticalSpeed, // Use the new parameter
                horizontalSpeed: horizontalSpeed
            }
        });
    }

    faceTarget(npc, target) {
        if (!target) return;
        
        const now = Date.now();
        if (npc.lastFaceUpdate && now - npc.lastFaceUpdate < 100) return; // Throttle facing updates
        
        const dirX = target.state.position[0] - npc.state.position[0];
        const dirZ = target.state.position[2] - npc.state.position[2];
        const orientation = Math.atan2(dirX, dirZ);
        
        npc.lastFaceUpdate = now;
        this.sendMovementPacket(npc, orientation, 0, 0);
    }

    findClosestPlayer(npc, aiManager) {
        const aggroRadius = npc.personalAggroRadius || this.plugin.AGGRO_RADIUS_MAX;
        let closestPlayer = null;
        let minDistance = aggroRadius;
        const now = Date.now();
        
        aiManager.playerEntities.forEach((player) => {
            if (!player.isAlive) return;
            
            // Quick grace period check for new players
            if (player.gameReadyTime && now - player.gameReadyTime < 10000) return;
            
            const distance = getDistance(npc.state.position, player.state.position);
            if (distance <= minDistance) {
                // Check line of sight if available
                if (this.plugin.pathfinding && this.plugin.pathfinding.hasLineOfSight) {
                    const hasLOS = this.plugin.pathfinding.hasLineOfSight(npc.state.position, player.state.position);
                    if (!hasLOS) {
                        return; // Skip this player - no line of sight
                    }
                }
                
                minDistance = distance;
                closestPlayer = player;
            }
        });
        return closestPlayer;
    }

    determineState(npc, player) {
    if (!player) return 'IDLE';
    
    // Get FRESH player position from server, not cached target parameter
    const server = npc.server;
    const client = server.getClientByCharId(player.characterId);
    if (!client || !client.character) return 'IDLE';
    
    const freshPlayerPosition = client.character.state.position;
    const distance = getDistance(npc.state.position, freshPlayerPosition);
    const verticalDistance = Math.abs(npc.state.position[1] - freshPlayerPosition[1]);
    const attackRadius = npc.personalAttackRadius || this.plugin.ATTACK_RADIUS_MAX;
    const aggroRadius = npc.personalAggroRadius || this.plugin.AGGRO_RADIUS_MAX;
    
    if (verticalDistance > this.plugin.MAX_VERTICAL_AGGRO_DISTANCE) { 
        return 'IDLE'; 
    }
    if (distance <= attackRadius) return 'ATTACKING';
    if (distance <= aggroRadius) return 'CHASING';
    return 'IDLE';
}
}

module.exports = ZombieAI;