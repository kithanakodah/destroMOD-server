// debugCommands.js - Cleaned and Simplified for destroMOD
"use strict";

class DebugCommands {
    constructor(plugin) {
        this.plugin = plugin;
        this.navMeshViz = null;
        
        // The visualizer is still needed for show_navmesh and show_agents
        try {
            const NavMeshVisualizer = require('./navMeshVisualizer.js');
            if (plugin.pathfinding) {
                this.navMeshViz = new NavMeshVisualizer(plugin.pathfinding);
                console.log(`[DebugCommands] NavMesh visualizer initialized for debug commands.`);
            }
        } catch (error) {
            console.warn(`[DebugCommands] Could not load NavMesh visualizer:`, error.message);
        }
    }

    setServer(server) {
        if (this.navMeshViz) {
            this.navMeshViz.setServer(server);
        }
    }

    update() {
        if (this.navMeshViz) {
            this.navMeshViz.update();
        }
    }

    getCommands() {
        return [
            // ===================================
            // HELP COMMAND
            // ===================================
            {
                name: "destromod_help",
                permissionLevel: 0,
                execute: (server, client, args) => {
                    server.sendChatText(client, "=== destroMOD Commands ===");
                    server.sendChatText(client, "NPCs: /spawn_human, /list_npcs, /debug_npc <id>");
                    server.sendChatText(client, "Crowd: /crowd_health");
                    server.sendChatText(client, "NavMesh: /test_path, /show_navmesh, /show_agents");
                    server.sendChatText(client, "💡 Use /hide_navmesh to clear visuals");
                }
            },

            // ===================================
            // CROWD MONITORING
            // ===================================
            {
                name: "crowd_health",
                permissionLevel: 0,
                execute: (server, client, args) => {
                    if (!this.plugin.pathfinding || !this.plugin.pathfinding.isReady) {
                        server.sendChatText(client, "❌ Pathfinding service not ready.");
                        return;
                    }
                    
                    const stats = this.plugin.pathfinding.getStats();
                    server.sendChatText(client, "=== Crowd Health Report ===");
                    server.sendChatText(client, `Service Ready: ${stats.isReady ? '✅ Yes' : '❌ No'}`);
                    server.sendChatText(client, `Active Agents: ${stats.crowdAgents} / ${stats.maxCapacity}`);
                    server.sendChatText(client, `Aggroed NPCs: ${stats.aggroedNPCs}`);
                    server.sendChatText(client, `Paths Calculated: ${stats.pathsCalculated}`);
                    server.sendChatText(client, `Crowd Updates: ${stats.crowdUpdates}`);
                }
            },

            // ===================================
            // NPC MANAGEMENT & DEBUGGING
            // ===================================
            {
                name: "list_npcs",
                permissionLevel: 0,
                execute: (server, client, args) => {
                    const npcs = Object.values(server._npcs);
                    const humanNpcs = npcs.filter(npc => npc.isHumanNPC);
                    const zombieNpcs = npcs.filter(npc => !npc.isHumanNPC);
                    const inCrowdCount = this.plugin.pathfinding.agents.size;
                    
                    server.sendChatText(client, "=== NPC Statistics ===");
                    server.sendChatText(client, `Total: ${npcs.length} | Humans: ${humanNpcs.length} | Zombies: ${zombieNpcs.length}`);
                    server.sendChatText(client, `In Crowd (Aggroed): ${inCrowdCount}`);
                }
            },
            {
                name: "debug_npc",
                permissionLevel: 0,
                execute: (server, client, args) => {
                    if (!args[0]) {
                        server.sendChatText(client, "Usage: /debug_npc <npcId>");
                        return;
                    }
                    const npc = server._npcs[args[0]];
                    if (!npc) {
                        server.sendChatText(client, `❌ NPC ${args[0]} not found.`);
                        return;
                    }
                    
                    const inCrowd = this.plugin.pathfinding.agents.has(npc.characterId);
                    const pos = npc.state.position;
                    
                    server.sendChatText(client, `=== NPC Debug: ${args[0]} ===`);
                    server.sendChatText(client, `Type: ${npc.isHumanNPC ? 'Human' : 'Zombie'} | Alive: ${npc.isAlive}`);
                    server.sendChatText(client, `AI State: ${npc.aiState || 'IDLE'} | In Crowd: ${inCrowd ? '✅ Yes' : '❌ No'}`);
                    server.sendChatText(client, `Position: [${pos[0].toFixed(1)}, ${pos[1].toFixed(1)}, ${pos[2].toFixed(1)}]`);
                }
            },
            {
                name: "spawn_human",
                permissionLevel: 0,
                execute: (server, client, args) => {
                    server.sendChatText(client, "Spawning human NPC...");
                    if (this.plugin.spawnHumanNPC(server, client)) {
                        server.sendChatText(client, "✅ Human NPC spawned successfully.");
                        setTimeout(() => this.plugin.equipAllHumanNPCs(server, client), 1000);
                    } else {
                        server.sendChatText(client, "❌ Failed to spawn NPC. Check console.");
                    }
                }
            },

            // ===================================
            // NAVMESH VISUALIZATION & TESTING
            // ===================================
            {
                name: "test_path",
                permissionLevel: 0,
                execute: (server, client, args) => {
                    if (!this.navMeshViz) {
                        server.sendChatText(client, "❌ NavMesh visualizer not available.");
                        return;
                    }
                    // Test a path 20 units forward from the player
                    const forward = Math.sin(client.character.state.orientation);
                    const right = Math.cos(client.character.state.orientation);
                    const targetPos = [
                        client.character.state.position[0] + forward * 20,
                        client.character.state.position[1],
                        client.character.state.position[2] + right * 20
                    ];
                    server.sendChatText(client, "Testing path 20 units forward...");
                    if (this.navMeshViz.testAndVisualizePath(client, targetPos)) {
                        server.sendChatText(client, "💡 Path visualized: Green=Start, Red=End, Blue=Waypoints.");
                    }
                }
            },
            {
                name: "show_navmesh",
                permissionLevel: 0,
                execute: (server, client, args) => {
                    if (!this.navMeshViz) {
                        server.sendChatText(client, "❌ NavMesh visualizer not available.");
                        return;
                    }
                    if (this.navMeshViz.toggleNavMeshVisualization(client)) {
                        server.sendChatText(client, "🗺️ NavMesh visualization enabled (Green markers).");
                    }
                }
            },
            {
                name: "show_agents",
                permissionLevel: 0,
                execute: (server, client, args) => {
                    if (!this.navMeshViz) {
                        server.sendChatText(client, "❌ NavMesh visualizer not available.");
                        return;
                    }
                    this.navMeshViz.showAgentPaths(client);
                    server.sendChatText(client, "🎨 Visualizing active agents (Red markers).");
                }
            },
            {
                name: "hide_navmesh", 
                permissionLevel: 0,
                execute: (server, client, args) => {
                    if (!this.navMeshViz) {
                        server.sendChatText(client, "❌ NavMesh visualizer not available.");
                        return;
                    }
                    this.navMeshViz.clearVisualizationForPlayer(client);
                    server.sendChatText(client, "✅ Visualizations cleared.");
                }
            }
        ];
    }
}

module.exports = DebugCommands;