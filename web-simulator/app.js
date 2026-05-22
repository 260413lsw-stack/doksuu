/**
 * Goa Distributed ACS Simulator - Core Logic (Enhanced 3D Robot Arm Relay Version)
 * Authors: Antigravity AI Coding Assistant & Student
 */

window.addEventListener('DOMContentLoaded', () => {
    // --- 1. Global Configurations & State ---
    const canvas = document.getElementById('sim-canvas');
    if (!canvas) {
        console.error("Error: Canvas element '#sim-canvas' not found.");
        return;
    }
    const ctx = canvas.getContext('2d');

    let isRunning = false;
    let currentMode = 'mono'; // 'mono' (Monolithic) or 'dist' (Goa Distributed)
    let simulationSpeed = 2;
    let orderSpawnRate = 6; // 1 to 10
    let animationFrameId = null;

    // Metrics
    let stats = {
        mono: { throughput: 0, totalTime: 0, activeTime: 0, collisions: 0, latencySamples: [], collisionSamples: [] },
        dist: { throughput: 0, totalTime: 0, activeTime: 0, collisions: 0, latencySamples: [], collisionSamples: [] }
    };
    let activeStats = { throughput: 0, avgLeadTime: 0.0, collisionRate: 0, latency: 0, cpu: 0 };
    let simulationTime = 0;
    let ordersList = [];
    
    // Warehouse Layout coordinates (Grid cells: 20x12 grid)
    const gridCols = 20;
    const gridRows = 12;
    const cellWidth = canvas.width / gridCols;
    const cellHeight = canvas.height / gridRows;

    // Warehouse map entities
    const MapEntities = {
        racks: [],
        aisle1X: 4,  // Column index for Aisle 1
        aisle2X: 12, // Column index for Aisle 2
        interceptorCorridorY: 9, // Row index for high-speed corridor
        buffer1: { x: 4, y: 9, isOccupied: false, item: null, robotWaiting: false },
        buffer2: { x: 12, y: 9, isOccupied: false, item: null, robotWaiting: false },
        shippingDock: { x: 18, y: 9 } // Shipping dock destination
    };

    // Initialize racks (Zoning Structure)
    // Aisle 1 Racks
    for (let c = 1; c <= 3; c++) {
        for (let r = 1; r <= 8; r++) {
            MapEntities.racks.push({ x: c, y: r, aisle: 1 });
        }
    }
    // Aisle 2 Racks
    for (let c = 9; c <= 11; c++) {
        for (let r = 1; r <= 8; r++) {
            MapEntities.racks.push({ x: c, y: r, aisle: 2 });
        }
    }

    // Robots Array
    let amrs = [];

    // --- 2. 3D Robotic Arm Class (Air-Relay Mechanism) ---
    class RoboticArm {
        constructor(id, baseGridX, baseGridY, targetBuffer, targetRelayX, targetRelayY) {
            this.id = id;
            this.baseX = baseGridX * cellWidth + cellWidth / 2;
            this.baseY = (baseGridY - 0.5) * cellHeight; // Positioned slightly above buffer
            this.targetBuffer = targetBuffer; // Buffer reference
            
            // Physical joints variables
            this.joint1X = this.baseX;
            this.joint1Y = this.baseY;
            this.joint2X = this.baseX;
            this.joint2Y = this.baseY;
            this.handX = this.baseX;
            this.handY = this.baseY;

            // Target positions
            this.bufferX = targetBuffer.x * cellWidth + cellWidth / 2;
            this.bufferY = targetBuffer.y * cellHeight + cellHeight / 2;
            this.relayX = targetRelayX * cellWidth + cellWidth / 2;
            this.relayY = targetRelayY * cellHeight + cellHeight / 2;

            // Arm states: 'IDLE', 'REACHING_BUFFER', 'GRABBING', 'REACHING_RELAY', 'PLACING', 'RETURNING'
            this.state = 'IDLE';
            this.progress = 0;
            this.currentItem = null;
            this.zHeight = 0; // Simulated height for 3D depth effect
            
            // Visual angles for calculation
            this.angle1 = -Math.PI / 2;
            this.angle2 = 0;
        }

        update() {
            if (currentMode === 'mono') {
                this.state = 'IDLE';
                this.progress = 0;
                this.zHeight = 0;
                this.currentItem = null;
                return;
            }

            const speed = 0.03 * simulationSpeed;

            switch (this.state) {
                case 'IDLE':
                    // Check if buffer has item and it's not being handled, and a relay robot is waiting at the relay spot
                    if (this.targetBuffer.isOccupied && this.targetBuffer.item && !this.currentItem) {
                        const relayRobot = amrs.find(r => r.type === 'interceptor' && 
                            Math.abs(r.x - (this.targetBuffer.x)) < 1 && r.status === 'WAITING_ARM' && !r.currentItem);
                        
                        if (relayRobot) {
                            this.currentItem = this.targetBuffer.item;
                            this.state = 'REACHING_BUFFER';
                            this.progress = 0;
                            addLog(`[Goa-ACS Arm-${this.id}] Initiating picking sequence for Item ${this.currentItem.id} from Buffer.`, 'dist');
                        }
                    }
                    // Resting position
                    this.interpolateTo(this.baseX, this.baseY - 40, 0, speed);
                    break;

                case 'REACHING_BUFFER':
                    this.progress += speed;
                    this.interpolateTo(this.bufferX, this.bufferY, 0, speed);
                    if (this.progress >= 1) {
                        this.state = 'GRABBING';
                        this.progress = 0;
                    }
                    break;

                case 'GRABBING':
                    this.progress += speed * 2;
                    // Lowering and grabbing item
                    if (this.progress >= 1) {
                        this.targetBuffer.isOccupied = false;
                        this.targetBuffer.item = null;
                        this.state = 'REACHING_RELAY';
                        this.progress = 0;
                        addLog(`[Goa-ACS Arm-${this.id}] Item ${this.currentItem.id} secured. Initiating air transfer to Relay.`, 'success');
                    }
                    break;

                case 'REACHING_RELAY':
                    this.progress += speed;
                    // Lift the item in 3D (simulate zHeight with sine wave)
                    this.zHeight = Math.sin(this.progress * Math.PI) * 50; 
                    
                    // Move hand towards relay position
                    this.interpolateTo(this.relayX, this.relayY, this.zHeight, speed);

                    if (this.progress >= 0.9) {
                        // Alert relay robot that item is arriving
                        const relayRobot = amrs.find(r => r.type === 'interceptor' && 
                            Math.abs(r.x - (this.targetBuffer.x)) < 1 && r.status === 'WAITING_ARM');
                        if (relayRobot) {
                            relayRobot.status = 'LOADED';
                            relayRobot.currentItem = this.currentItem;
                            relayRobot.setPathTo(MapEntities.shippingDock.x, MapEntities.shippingDock.y);
                            addLog(`[Goa-ACS Arm-${this.id}] Handing over Item ${this.currentItem.id} to Relay AMR ${relayRobot.id}.`, 'success');
                        }
                    }

                    if (this.progress >= 1) {
                        this.state = 'PLACING';
                        this.progress = 0;
                    }
                    break;

                case 'PLACING':
                    this.progress += speed * 2;
                    this.zHeight = Math.max(0, this.zHeight - 5);
                    if (this.progress >= 1) {
                        this.currentItem = null;
                        this.state = 'RETURNING';
                        this.progress = 0;
                    }
                    break;

                case 'RETURNING':
                    this.progress += speed;
                    this.interpolateTo(this.baseX, this.baseY - 40, 0, speed);
                    if (this.progress >= 1) {
                        this.state = 'IDLE';
                        this.progress = 0;
                    }
                    break;
            }
        }

        interpolateTo(tx, ty, tz, speed) {
            // Simple IK drawing simulation
            const dx = tx - this.baseX;
            const dy = ty - this.baseY - tz;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Double segment arm lengths
            const L1 = 60;
            const L2 = 50;

            // Target angles (Clamped)
            let targetAngle = Math.atan2(dy, dx);
            this.handX = tx;
            this.handY = ty - tz;

            // Intermediate joint calculation
            this.joint1X = this.baseX + Math.cos(targetAngle) * (dist * 0.5);
            this.joint1Y = this.baseY + Math.sin(targetAngle) * (dist * 0.5) - 15; // Raised joint for 3D elbow look
        }

        draw() {
            if (currentMode === 'mono') return; // Do not draw in Monolithic mode

            // Draw shadow of the arm
            ctx.beginPath();
            ctx.moveTo(this.baseX, this.baseY);
            ctx.lineTo(this.joint1X, this.joint1Y + this.zHeight * 0.2 + 20);
            ctx.lineTo(this.handX, this.handY + this.zHeight * 0.5 + 20);
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Draw base stand
            ctx.beginPath();
            ctx.arc(this.baseX, this.baseY, 12, 0, Math.PI * 2);
            ctx.fillStyle = '#1e293b';
            ctx.strokeStyle = 'var(--neon-pink)';
            ctx.lineWidth = 3;
            ctx.fill();
            ctx.stroke();

            // Draw Segment 1 (Shoulder to Elbow)
            ctx.beginPath();
            ctx.moveTo(this.baseX, this.baseY);
            ctx.lineTo(this.joint1X, this.joint1Y);
            ctx.strokeStyle = 'var(--neon-pink)';
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Draw Segment 2 (Elbow to Hand)
            ctx.beginPath();
            ctx.moveTo(this.joint1X, this.joint1Y);
            ctx.lineTo(this.handX, this.handY);
            ctx.strokeStyle = '#f472b6';
            ctx.lineWidth = 5;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Draw Joint pivot
            ctx.beginPath();
            ctx.arc(this.joint1X, this.joint1Y, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();

            // Draw End Effector / Gripper
            ctx.beginPath();
            ctx.arc(this.handX, this.handY, 7, 0, Math.PI * 2);
            ctx.fillStyle = 'var(--neon-pink)';
            ctx.fill();

            // Draw Item in air with 3D Z-Scaling
            if (this.currentItem) {
                const scale = 1 + (this.zHeight / 100); // Larger as it gets closer to camera
                const boxW = (cellWidth / 2) * scale;
                const boxH = (cellHeight / 2) * scale;

                ctx.save();
                ctx.translate(this.handX, this.handY);
                // Drop shadow of item
                ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                ctx.fillRect(-boxW/2, -boxH/2 + this.zHeight, boxW, boxH);

                // Draw physical box
                ctx.fillStyle = 'var(--neon-yellow)';
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.fillRect(-boxW/2 - 2, -boxH/2 - 2, boxW + 4, boxH + 4);
                ctx.strokeRect(-boxW/2 - 2, -boxH/2 - 2, boxW + 4, boxH + 4);

                // Inner detail (cardboard look)
                ctx.fillStyle = 'rgba(0,0,0,0.1)';
                ctx.fillRect(-boxW/4, -boxH/4, boxW/2, boxH/2);
                ctx.restore();
            }
        }
    }

    const arms = [
        new RoboticArm('A1', MapEntities.buffer1.x, MapEntities.buffer1.y - 1, MapEntities.buffer1, MapEntities.buffer1.x, MapEntities.interceptorCorridorY),
        new RoboticArm('A2', MapEntities.buffer2.x, MapEntities.buffer2.y - 1, MapEntities.buffer2, MapEntities.buffer2.x, MapEntities.interceptorCorridorY)
    ];

    // --- 3. Robot Class Definition (Agent) ---
    class AMR {
        constructor(id, type, startX, startY, color, constrainedAisle = null) {
            this.id = id;
            this.type = type; // 'aisle', 'interceptor', 'mono'
            this.x = startX;
            this.y = startY;
            this.color = color;
            this.constrainedAisle = constrainedAisle; // 1, 2, or null
            
            // Navigation states
            this.targetX = startX;
            this.targetY = startY;
            this.status = 'IDLE'; // IDLE, MOVING, PICKING, LOADED, DELAYED, WAITING_ARM
            this.path = [];
            this.currentItem = null;
            this.progress = 0; // Movement interpolation (0 to 1)
            this.delayTicks = 0; // Simulated deadlock / collision delay
        }

        update() {
            if (this.delayTicks > 0) {
                this.delayTicks--;
                if (this.delayTicks === 0) {
                    this.status = 'MOVING';
                }
                return;
            }

            if (this.status === 'WAITING_ARM') {
                return; // Paused until robotic arm grabs/transfers the box
            }

            // If at destination coordinate, check for next node in path
            if (this.x === this.targetX && this.y === this.targetY) {
                if (this.path.length > 0) {
                    const nextNode = this.path.shift();
                    
                    // Collision & Bottleneck Detection logic
                    const collisionChance = currentMode === 'mono' ? 0.35 : 0.02;
                    const isOccupied = amrs.some(other => 
                        other.id !== this.id && 
                        (other.targetX === nextNode.x && other.targetY === nextNode.y)
                    );
                    
                    if (isOccupied && Math.random() < collisionChance) { 
                        this.delayTicks = currentMode === 'mono' ? 45 + Math.floor(Math.random() * 50) : 10 + Math.floor(Math.random() * 15); 
                        this.status = 'DELAYED';
                        
                        if (currentMode === 'mono') {
                            stats.mono.collisions++;
                            activeStats.collisionRate = Math.min(28, activeStats.collisionRate + 3);
                            addLog(`[Mono-ACS] Path Block: Global AMR ${this.id} grid bottleneck at (${nextNode.x}, ${nextNode.y}). Recalculating path.`, 'alert');
                        } else {
                            stats.dist.collisions++;
                            activeStats.collisionRate = Math.min(5, activeStats.collisionRate + 1);
                            addLog(`[Goa-ACS] Local micro-delay: ${this.id} waiting at (${nextNode.x}, ${nextNode.y}) for safety clearance.`, 'system');
                        }
                        return;
                    }

                    this.targetX = nextNode.x;
                    this.targetY = nextNode.y;
                    this.progress = 0;
                    this.status = 'MOVING';
                } else {
                    this.onReachedDestination();
                }
            }

            // Interpolation movement
            if (this.x !== this.targetX || this.y !== this.targetY) {
                const step = 0.06 * simulationSpeed;
                this.progress += step;
                if (this.progress >= 1) {
                    this.x = this.targetX;
                    this.y = this.targetY;
                    this.progress = 0;
                }
            }
        }

        onReachedDestination() {
            if (this.status === 'MOVING') {
                if (this.currentItem) {
                    if (currentMode === 'mono') {
                        // Monolithic: Move directly from rack to shipping dock
                        if (this.x === this.currentItem.rack.x && this.y === this.currentItem.rack.y && !this.currentItem.isPicked) {
                            this.status = 'PICKING';
                            this.delayTicks = 25; 
                            this.currentItem.isPicked = true;
                            addLog(`[Mono-ACS] ${this.id} reached rack (${this.x}, ${this.y}). Picking Item ${this.currentItem.id}.`, 'mono');
                        } else if (this.x === MapEntities.shippingDock.x && this.y === MapEntities.shippingDock.y) {
                            this.status = 'IDLE';
                            completeOrder(this.currentItem);
                            this.currentItem = null;
                        } else {
                            this.setPathTo(MapEntities.shippingDock.x, MapEntities.shippingDock.y);
                        }
                    } else {
                        // Goa Distributed Mode logic
                        if (this.type === 'aisle') {
                            if (this.x === this.currentItem.rack.x && this.y === this.currentItem.rack.y && !this.currentItem.isPicked) {
                                this.status = 'PICKING';
                                this.delayTicks = 20;
                                this.currentItem.isPicked = true;
                                addLog(`[Goa-ACS Aisle-${this.constrainedAisle}] ${this.id} picking Item ${this.currentItem.id} from Local Zone.`, 'dist');
                            } else if (this.x === (this.constrainedAisle === 1 ? MapEntities.buffer1.x : MapEntities.buffer2.x) && 
                                     this.y === (this.constrainedAisle === 1 ? MapEntities.buffer1.y : MapEntities.buffer2.y)) {
                                const buffer = this.constrainedAisle === 1 ? MapEntities.buffer1 : MapEntities.buffer2;
                                
                                if (!buffer.isOccupied) {
                                    buffer.isOccupied = true;
                                    buffer.item = this.currentItem;
                                    this.currentItem.isAtBuffer = true;
                                    addLog(`[Goa-ACS Aisle-${this.constrainedAisle}] POST /aisle/${this.constrainedAisle}/buffer - Loaded Item ${this.currentItem.id} to buffer.`, 'success');
                                    
                                    triggerGoaInterceptRequest(this.constrainedAisle, this.currentItem);
                                    
                                    this.currentItem = null;
                                    this.status = 'IDLE';
                                } else {
                                    this.delayTicks = 10;
                                    this.status = 'DELAYED';
                                }
                            } else {
                                const buffer = this.constrainedAisle === 1 ? MapEntities.buffer1 : MapEntities.buffer2;
                                this.setPathTo(buffer.x, buffer.y);
                            }
                        } else if (this.type === 'interceptor') {
                            // Interceptor / Relay robot: waits at y=9, x=bufferX
                            if (this.x === MapEntities.shippingDock.x && this.y === MapEntities.shippingDock.y) {
                                this.status = 'IDLE';
                                completeOrder(this.currentItem);
                                this.currentItem = null;
                                // Return to standby position
                                const standbyX = this.id.includes('01') ? 4 : 12;
                                this.setPathTo(standbyX, MapEntities.interceptorCorridorY);
                            }
                        }
                    }
                } else {
                    this.status = 'IDLE';
                }
            } else if (this.status === 'PICKING') {
                this.status = 'LOADED';
                if (currentMode === 'mono') {
                    this.setPathTo(MapEntities.shippingDock.x, MapEntities.shippingDock.y);
                } else {
                    if (this.type === 'aisle') {
                        const buffer = this.constrainedAisle === 1 ? MapEntities.buffer1 : MapEntities.buffer2;
                        this.setPathTo(buffer.x, buffer.y);
                    }
                }
            }
        }

        setPathTo(tx, ty) {
            this.path = calculatePath(this.x, this.y, tx, ty, this.type === 'interceptor' ? 'interceptor' : this.constrainedAisle);
        }

        draw() {
            const drawX = this.x * cellWidth + (this.targetX - this.x) * cellWidth * this.progress;
            const drawY = this.y * cellHeight + (this.targetY - this.y) * cellHeight * this.progress;

            ctx.beginPath();
            ctx.arc(drawX + cellWidth / 2, drawY + cellHeight / 2, cellWidth / 2.3, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 8;
            ctx.fill();
            ctx.shadowBlur = 0; 

            // Inner styling
            ctx.beginPath();
            ctx.arc(drawX + cellWidth / 2, drawY + cellHeight / 2, cellWidth / 4, 0, Math.PI * 2);
            ctx.fillStyle = '#0f172a';
            ctx.fill();

            if (this.status === 'LOADED' && this.currentItem) {
                ctx.fillStyle = 'var(--neon-yellow)';
                ctx.fillRect(drawX + cellWidth / 3, drawY + cellHeight / 3, cellWidth / 3, cellHeight / 3);
                ctx.strokeStyle = '#ffffff';
                ctx.strokeRect(drawX + cellWidth / 3, drawY + cellHeight / 3, cellWidth / 3, cellHeight / 3);
            }

            if (this.status === 'DELAYED') {
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(drawX + cellWidth / 2, drawY + cellHeight / 2, cellWidth / 2.3, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.fillStyle = '#ffffff';
            ctx.font = '8px Outfit';
            ctx.textAlign = 'center';
            ctx.fillText(this.id, drawX + cellWidth / 2, drawY + cellHeight / 2 - cellHeight / 2.2);
        }
    }

    // --- 4. Pathfinding Algorithm ---
    function calculatePath(sx, sy, tx, ty, aisleConstrain = null) {
        const path = [];
        let cx = sx;
        let cy = sy;

        const maxSteps = 100;
        let steps = 0;

        while ((cx !== tx || cy !== ty) && steps < maxSteps) {
            steps++;
            if (aisleConstrain === 1) {
                // Aisle 1 Robot constraint: stays in column 1 to 4
                if (cx !== tx) {
                    if (cx < tx) cx++;
                    else cx--;
                } else if (cy !== ty) {
                    if (cy < ty) cy++;
                    else cy--;
                }
            } else if (aisleConstrain === 2) {
                // Aisle 2 Robot constraint: stays in column 9 to 12
                if (cx !== tx) {
                    if (cx < tx) cx++;
                    else cx--;
                } else if (cy !== ty) {
                    if (cy < ty) cy++;
                    else cy--;
                }
            } else if (aisleConstrain === 'interceptor') {
                // High-speed Interceptor: moves mostly on y=9 corridor
                if (cy !== MapEntities.interceptorCorridorY && cx !== tx) {
                    // Get to corridor first
                    if (cy < MapEntities.interceptorCorridorY) cy++;
                    else cy--;
                } else {
                    if (cx < tx) cx++;
                    else if (cx > tx) cx--;
                    else if (cy < ty) cy++;
                    else if (cy > ty) cy--;
                }
            } else {
                // Monolithic path planning (Dijkstra-like simple grid navigation)
                if (cx !== tx) {
                    if (cx < tx) cx++;
                    else cx--;
                } else if (cy !== ty) {
                    if (cy < ty) cy++;
                    else cy--;
                }
            }
            path.push({ x: cx, y: cy });
        }
        return path;
    }

    // --- 5. Goa API Call Simulator ---
    function triggerGoaInterceptRequest(aisleId, item) {
        addLog(`[Goa-API] POST /interceptor/request - Source Aisle: ${aisleId}, Target: Dock, Item: ${item.id}`, 'dist');
        
        const standbyX = aisleId === 1 ? 4 : 12;
        const interceptor = amrs.find(r => r.type === 'interceptor' && r.id.includes(aisleId.toString()));
        
        if (interceptor) {
            if (interceptor.status === 'IDLE' && !interceptor.currentItem) {
                interceptor.status = 'WAITING_ARM';
                interceptor.setPathTo(standbyX, MapEntities.interceptorCorridorY);
                addLog(`[Goa-ACS] Relay AMR ${interceptor.id} dispatched to Standby Spot (${standbyX}, 9).`, 'success');
            }
        }
    }

    // --- 6. Order Management ---
    function createOrder() {
        const isAisle1 = Math.random() < 0.5;
        const aisleRacks = MapEntities.racks.filter(r => r.aisle === (isAisle1 ? 1 : 2));
        const randomRack = aisleRacks[Math.floor(Math.random() * aisleRacks.length)];
        
        const order = {
            id: 'ORD-' + (Math.floor(Math.random() * 900) + 100),
            rack: randomRack,
            aisle: isAisle1 ? 1 : 2,
            isPicked: false,
            isAtBuffer: false,
            isPickedByInterceptor: false,
            startTime: Date.now(),
            completionTime: null
        };

        ordersList.push(order);
        
        if (currentMode === 'mono') {
            // Monolithic: assign globally to any idle AMR
            const idleAMR = amrs.find(r => r.status === 'IDLE');
            if (idleAMR) {
                idleAMR.currentItem = order;
                idleAMR.status = 'MOVING';
                idleAMR.setPathTo(order.rack.x, order.rack.y);
                addLog(`[Mono-ACS] Global Assign: Order ${order.id} allocated to AMR ${idleAMR.id}`, 'mono');
            }
        } else {
            // Distributed: assign to local zone AMR
            const idleAisleAMR = amrs.find(r => r.type === 'aisle' && r.constrainedAisle === order.aisle && r.status === 'IDLE');
            if (idleAisleAMR) {
                idleAisleAMR.currentItem = order;
                idleAisleAMR.status = 'MOVING';
                idleAisleAMR.setPathTo(order.rack.x, order.rack.y);
                addLog(`[Goa-ACS Aisle-${order.aisle}] Local Assign: Order ${order.id} allocated to local AMR ${idleAisleAMR.id}`, 'dist');
            }
        }
    }

    function completeOrder(order) {
        order.completionTime = Date.now();
        const duration = (order.completionTime - order.startTime) / 1000;
        
        if (currentMode === 'mono') {
            stats.mono.throughput++;
            stats.mono.totalTime += duration;
        } else {
            stats.dist.throughput++;
            stats.dist.totalTime += duration;
        }

        activeStats.throughput++;
        const currentTotalTime = currentMode === 'mono' ? stats.mono.totalTime : stats.dist.totalTime;
        const currentThroughput = currentMode === 'mono' ? stats.mono.throughput : stats.dist.throughput;
        activeStats.avgLeadTime = (currentTotalTime / currentThroughput).toFixed(1);
        
        updateDashboardMetrics();
        addLog(`[System] Success: Completed delivery of ${order.id} in ${duration.toFixed(1)}s.`, 'success');

        // Check if there are unassigned orders that need to be processed
        if (currentMode === 'mono') {
            const nextUnassigned = ordersList.find(o => !o.completionTime && !amrs.some(r => r.currentItem && r.currentItem.id === o.id));
            if (nextUnassigned) {
                const idleAMR = amrs.find(r => r.status === 'IDLE');
                if (idleAMR) {
                    idleAMR.currentItem = nextUnassigned;
                    idleAMR.status = 'MOVING';
                    idleAMR.setPathTo(nextUnassigned.rack.x, nextUnassigned.rack.y);
                }
            }
        } else {
            const nextAisle1 = ordersList.find(o => o.aisle === 1 && !o.completionTime && !o.isPicked && !amrs.some(r => r.currentItem && r.currentItem.id === o.id));
            if (nextAisle1) {
                const idleAMR = amrs.find(r => r.type === 'aisle' && r.constrainedAisle === 1 && r.status === 'IDLE');
                if (idleAMR) {
                    idleAMR.currentItem = nextAisle1;
                    idleAMR.status = 'MOVING';
                    idleAMR.setPathTo(nextAisle1.rack.x, nextAisle1.rack.y);
                }
            }
            const nextAisle2 = ordersList.find(o => o.aisle === 2 && !o.completionTime && !o.isPicked && !amrs.some(r => r.currentItem && r.currentItem.id === o.id));
            if (nextAisle2) {
                const idleAMR = amrs.find(r => r.type === 'aisle' && r.constrainedAisle === 2 && r.status === 'IDLE');
                if (idleAMR) {
                    idleAMR.currentItem = nextAisle2;
                    idleAMR.status = 'MOVING';
                    idleAMR.setPathTo(nextAisle2.rack.x, nextAisle2.rack.y);
                }
            }
        }
    }

    // --- 7. Visualizer Rendering ---
    function drawWarehouse() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw Modern Grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
        ctx.lineWidth = 1;
        for (let c = 0; c <= gridCols; c++) {
            ctx.beginPath();
            ctx.moveTo(c * cellWidth, 0);
            ctx.lineTo(c * cellWidth, canvas.height);
            ctx.stroke();
        }
        for (let r = 0; r <= gridRows; r++) {
            ctx.beginPath();
            ctx.moveTo(0, r * cellHeight);
            ctx.lineTo(canvas.width, r * cellHeight);
            ctx.stroke();
        }

        // Draw Aisle boundary / Background zoning highlight in Distributed Mode
        if (currentMode === 'dist') {
            // Zone 1
            ctx.fillStyle = 'rgba(6, 182, 212, 0.02)';
            ctx.fillRect(0, 0, 7 * cellWidth, cellHeight * 9);
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.1)';
            ctx.lineWidth = 1;
            ctx.strokeRect(0, 0, 7 * cellWidth, cellHeight * 9);
            
            // Zone 2
            ctx.fillStyle = 'rgba(6, 182, 212, 0.02)';
            ctx.fillRect(8 * cellWidth, 0, 7 * cellWidth, cellHeight * 9);
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.1)';
            ctx.lineWidth = 1;
            ctx.strokeRect(8 * cellWidth, 0, 7 * cellWidth, cellHeight * 9);
        }

        // Draw Interceptor High-speed corridor
        ctx.fillStyle = 'rgba(250, 204, 21, 0.02)';
        ctx.fillRect(0, MapEntities.interceptorCorridorY * cellHeight, canvas.width, cellHeight);
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.1)';
        ctx.strokeRect(0, MapEntities.interceptorCorridorY * cellHeight, canvas.width, cellHeight);

        // Draw Racks
        MapEntities.racks.forEach(rack => {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
            ctx.fillRect(rack.x * cellWidth + 2, rack.y * cellHeight + 2, cellWidth - 4, cellHeight - 4);
            ctx.strokeRect(rack.x * cellWidth + 2, rack.y * cellHeight + 2, cellWidth - 4, cellHeight - 4);
            
            // Draw visual shelves lines
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.beginPath();
            ctx.moveTo(rack.x * cellWidth + 5, rack.y * cellHeight + cellHeight / 2);
            ctx.lineTo(rack.x * cellWidth + cellWidth - 5, rack.y * cellHeight + cellHeight / 2);
            ctx.stroke();
        });

        // Draw Rendezvous Buffer Zones (High-tech style)
        [MapEntities.buffer1, MapEntities.buffer2].forEach((buf, idx) => {
            ctx.fillStyle = buf.isOccupied ? 'rgba(244, 114, 182, 0.15)' : 'rgba(244, 114, 182, 0.03)';
            ctx.strokeStyle = 'var(--neon-pink)';
            ctx.lineWidth = 2;
            ctx.fillRect(buf.x * cellWidth + 2, buf.y * cellHeight + 2, cellWidth - 4, cellHeight - 4);
            ctx.strokeRect(buf.x * cellWidth + 2, buf.y * cellHeight + 2, cellWidth - 4, cellHeight - 4);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = '10px Outfit';
            ctx.textAlign = 'center';
            ctx.fillText(`R-BUF-${idx+1}`, buf.x * cellWidth + cellWidth / 2, buf.y * cellHeight + cellHeight / 1.4);

            // Draw item in buffer if occupied (and not grabbed by arm)
            const arm = arms[idx];
            if (buf.isOccupied && arm.state !== 'GRABBING' && arm.state !== 'REACHING_RELAY') {
                ctx.fillStyle = 'var(--neon-yellow)';
                ctx.fillRect(buf.x * cellWidth + cellWidth / 4, buf.y * cellHeight + cellHeight / 4, cellWidth / 2, cellHeight / 2);
                ctx.strokeStyle = '#ffffff';
                ctx.strokeRect(buf.x * cellWidth + cellWidth / 4, buf.y * cellHeight + cellHeight / 4, cellWidth / 2, cellHeight / 2);
            }
        });

        // Draw Shipping Dock
        ctx.fillStyle = 'rgba(168, 85, 247, 0.1)';
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.7)';
        ctx.lineWidth = 2;
        ctx.fillRect(MapEntities.shippingDock.x * cellWidth + 1, MapEntities.shippingDock.y * cellHeight + 1, cellWidth * 2 - 2, cellHeight - 2);
        ctx.strokeRect(MapEntities.shippingDock.x * cellWidth + 1, MapEntities.shippingDock.y * cellHeight + 1, cellWidth * 2 - 2, cellHeight - 2);

        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText('SHIPPING DOCK', MapEntities.shippingDock.x * cellWidth + cellWidth, MapEntities.shippingDock.y * cellHeight + cellHeight / 1.4);

        // Draw Robots
        amrs.forEach(amr => amr.draw());

        // Draw Robotic Arms (Air Relay)
        arms.forEach(arm => arm.draw());
    }

    // --- 8. 100-Robot Scale Control performance simulator ---
    function simulateControlMetrics() {
        let latency = 0;
        let collisionRate = 0;
        let cpu = 0;

        if (currentMode === 'mono') {
            // 100-Robot Monolithic scaling: O(N^2) path recalculations
            // Central processor bottlenecks under high collision and route recalculations
            const baseLatency = 160;
            const routeCongestion = stats.mono.collisions * 8;
            latency = Math.min(380, baseLatency + routeCongestion + Math.floor(Math.random() * 40));

            // Collision rate grows due to zoning lack
            collisionRate = Math.min(35, 12 + (stats.mono.collisions * 0.8) + Math.floor(Math.random() * 5));
            
            // CPU load spikes
            cpu = Math.min(99, 70 + (stats.mono.collisions * 2) + Math.floor(Math.random() * 5));
        } else {
            // 100-Robot Distributed scaling: 10 Local agents managing 10 robots each.
            // Latency stays low O(10^2) flat.
            latency = Math.max(1, 2 + Math.floor(Math.random() * 3));
            
            // Spatial division prevents core area conflicts
            collisionRate = Math.max(0.1, 0.5 + (stats.dist.collisions * 0.05) + (Math.random() * 0.5));
            
            // CPU remains extremely low
            cpu = Math.max(5, 8 + Math.floor(Math.random() * 4));
        }

        activeStats.latency = latency;
        activeStats.collisionRate = collisionRate;
        activeStats.cpu = cpu;

        if (currentMode === 'mono') {
            stats.mono.latencySamples.push(latency);
            stats.mono.collisionSamples.push(collisionRate);
        } else {
            stats.dist.latencySamples.push(latency);
            stats.dist.collisionSamples.push(collisionRate);
        }
    }

    // --- 9. Simulation Engine Loop ---
    function simLoop() {
        if (!isRunning) return;

        simulationTime++;

        const spawnThreshold = 0.006 * orderSpawnRate;
        if (Math.random() < spawnThreshold) {
            createOrder();
        }

        amrs.forEach(amr => amr.update());
        arms.forEach(arm => arm.update());

        if (simulationTime % 25 === 0) {
            simulateControlMetrics();
            updateDashboardMetrics();
            updateCharts();
        }

        drawWarehouse();

        animationFrameId = requestAnimationFrame(simLoop);
    }

    // --- 10. UI & Controls update ---
    function updateDashboardMetrics() {
        document.getElementById('metric-throughput').innerText = activeStats.throughput;
        document.getElementById('metric-leadtime').innerText = activeStats.avgLeadTime + 's';
        
        const latencyBox = document.getElementById('metric-latency');
        latencyBox.innerText = `${activeStats.latency} ms`;
        if (activeStats.latency > 100) {
            latencyBox.className = 'metric-value status-bad';
        } else {
            latencyBox.className = 'metric-value status-good';
        }

        const colBox = document.getElementById('metric-collision');
        colBox.innerText = `${activeStats.collisionRate.toFixed(1)}%`;
        if (activeStats.collisionRate > 10) {
            colBox.className = 'metric-value status-bad';
        } else {
            colBox.className = 'metric-value status-good';
        }

        document.getElementById('metric-cpu').innerText = `${activeStats.cpu}%`;
    }

    function addLog(text, type = 'system') {
        const consoleBox = document.getElementById('log-output');
        if (!consoleBox) return;
        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        line.innerText = `[${new Date().toLocaleTimeString()}] ${text}`;
        consoleBox.appendChild(line);
        consoleBox.scrollTop = consoleBox.scrollHeight;
    }

    function initRobots() {
        amrs = [];
        if (currentMode === 'mono') {
            // 8 Global Monolithic robots moving anywhere
            amrs.push(new AMR('AMR-01', 'mono', 1, 1, 'var(--neon-cyan)'));
            amrs.push(new AMR('AMR-02', 'mono', 3, 3, 'var(--neon-cyan)'));
            amrs.push(new AMR('AMR-03', 'mono', 9, 2, 'var(--neon-cyan)'));
            amrs.push(new AMR('AMR-04', 'mono', 11, 4, 'var(--neon-cyan)'));
            amrs.push(new AMR('AMR-05', 'mono', 2, 7, 'var(--neon-cyan)'));
            amrs.push(new AMR('AMR-06', 'mono', 10, 8, 'var(--neon-cyan)'));
            amrs.push(new AMR('AMR-07', 'mono', 5, 9, 'var(--neon-cyan)'));
            amrs.push(new AMR('AMR-08', 'mono', 14, 9, 'var(--neon-cyan)'));
        } else {
            // Goa Distributed Structure:
            // 3 Aisle-1 Dedicated, 3 Aisle-2 Dedicated, 2 Interceptor Relay Robots
            amrs.push(new AMR('Aisle1-AMR1', 'aisle', 1, 2, 'var(--neon-cyan)', 1));
            amrs.push(new AMR('Aisle1-AMR2', 'aisle', 2, 5, 'var(--neon-cyan)', 1));
            amrs.push(new AMR('Aisle1-AMR3', 'aisle', 3, 8, 'var(--neon-cyan)', 1));

            amrs.push(new AMR('Aisle2-AMR1', 'aisle', 9, 2, 'var(--neon-cyan)', 2));
            amrs.push(new AMR('Aisle2-AMR2', 'aisle', 10, 5, 'var(--neon-cyan)', 2));
            amrs.push(new AMR('Aisle2-AMR3', 'aisle', 11, 8, 'var(--neon-cyan)', 2));

            amrs.push(new AMR('Relay-AMR1', 'interceptor', 4, MapEntities.interceptorCorridorY, 'var(--neon-yellow)', 'interceptor'));
            amrs.push(new AMR('Relay-AMR2', 'interceptor', 12, MapEntities.interceptorCorridorY, 'var(--neon-yellow)', 'interceptor'));
        }
    }

    function switchMode(mode) {
        if (currentMode === mode) return;
        currentMode = mode;
        addLog(`[System] 관제 모드 전환 -> ${mode === 'mono' ? 'Monolithic (단일 컴퓨터 제어)' : 'Goa Distributed (분산 컴퓨터 제어 + 3D 로봇팔)'}`);
        
        document.getElementById('mode-mono').classList.toggle('active', mode === 'mono');
        document.getElementById('mode-dist').classList.toggle('active', mode === 'dist');

        resetSimulator();
    }

    function startSimulator() {
        if (isRunning) return;
        isRunning = true;
        document.getElementById('btn-start').disabled = true;
        document.getElementById('btn-pause').disabled = false;
        document.getElementById('sim-status-text').innerText = '시뮬레이션 구동 중';
        const dot = document.querySelector('.dot');
        if (dot) dot.classList.add('blinking');
        
        addLog(`[System] 시뮬레이션 가동. 모드: ${currentMode === 'mono' ? 'Monolithic' : 'Goa 분산 릴레이'}`, 'success');
        simLoop();
    }

    function pauseSimulator() {
        if (!isRunning) return;
        isRunning = false;
        document.getElementById('btn-start').disabled = false;
        document.getElementById('btn-pause').disabled = true;
        document.getElementById('sim-status-text').innerText = '시뮬레이션 일시정지됨';
        const dot = document.querySelector('.dot');
        if (dot) dot.classList.remove('blinking');
        cancelAnimationFrame(animationFrameId);
        addLog(`[System] 시뮬레이션 일시정지.`);
    }

    function resetSimulator() {
        pauseSimulator();
        simulationTime = 0;
        ordersList = [];
        
        activeStats = {
            throughput: currentMode === 'mono' ? stats.mono.throughput : stats.dist.throughput,
            avgLeadTime: 0.0,
            collisionRate: currentMode === 'mono' ? stats.mono.collisions : stats.dist.collisions,
            latency: currentMode === 'mono' ? 160 : 2,
            cpu: 0
        };
        
        MapEntities.buffer1.isOccupied = false;
        MapEntities.buffer1.item = null;
        MapEntities.buffer2.isOccupied = false;
        MapEntities.buffer2.item = null;

        initRobots();
        drawWarehouse();
        updateDashboardMetrics();
        addLog(`[System] 시뮬레이터 초기화 완료.`, 'system');
    }

    // --- 11. Chart.js Implementation (Custom Latency & Collision Charts) ---
    let latencyChart = null;
    let collisionChart = null;
    let chartsAvailable = false;

    function initCharts() {
        if (typeof Chart === 'undefined') {
            console.warn("Chart.js was not loaded. UI fallback to textual metrics.");
            addLog("[System] Warning: Chart.js 로드 실패. 실시간 그래프 대신 지표 텍스트를 참조하십시오.", "alert");
            return;
        }

        try {
            const latencyCtx = document.getElementById('chart-latency');
            const collisionCtx = document.getElementById('chart-collision');

            if (!latencyCtx || !collisionCtx) return;

            Chart.defaults.color = '#90a0b7';
            Chart.defaults.font.family = 'Outfit';

            // Latency Chart: Monolithic vs Distributed Latency (Line)
            latencyChart = new Chart(latencyCtx.getContext('2d'), {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Monolithic (단일 컴퓨터 연산 지연 ms)',
                            data: [],
                            borderColor: '#ff007f',
                            backgroundColor: 'rgba(255, 0, 127, 0.05)',
                            borderWidth: 2,
                            tension: 0.3,
                            fill: true
                        },
                        {
                            label: 'Distributed (분산 컴퓨터 연산 지연 ms)',
                            data: [],
                            borderColor: '#00f0ff',
                            backgroundColor: 'rgba(0, 240, 255, 0.05)',
                            borderWidth: 2,
                            tension: 0.3,
                            fill: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { position: 'top', labels: { boxWidth: 12 } },
                        title: { display: true, text: '100대 로봇 스케일 연산 Latency (ms)', color: '#ffffff' }
                    },
                    scales: {
                        y: { min: 0, max: 400, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                        x: { display: false }
                    }
                }
            });

            // Collision Rate Chart: Monolithic vs Distributed Collision (Line/Bar)
            collisionChart = new Chart(collisionCtx.getContext('2d'), {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Monolithic (단일 컴퓨터 충돌률 %)',
                            data: [],
                            borderColor: '#f59e0b',
                            backgroundColor: 'rgba(245, 158, 11, 0.05)',
                            borderWidth: 2,
                            tension: 0.3,
                            fill: true
                        },
                        {
                            label: 'Distributed (분산 컴퓨터 충돌률 %)',
                            data: [],
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.05)',
                            borderWidth: 2,
                            tension: 0.3,
                            fill: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { position: 'top', labels: { boxWidth: 12 } },
                        title: { display: true, text: '100대 로봇 스케일 충돌률 (%)', color: '#ffffff' }
                    },
                    scales: {
                        y: { min: 0, max: 40, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                        x: { display: false }
                    }
                }
            });
            chartsAvailable = true;
        } catch (e) {
            console.error("Chart.js initialization failed: ", e);
        }
    }

    function updateCharts() {
        if (!chartsAvailable) return;
        try {
            const sampleLength = Math.max(stats.mono.latencySamples.length, stats.dist.latencySamples.length);
            const labels = Array.from({ length: sampleLength }, (_, i) => i);

            if (latencyChart) {
                latencyChart.data.labels = labels;
                latencyChart.data.datasets[0].data = stats.mono.latencySamples;
                latencyChart.data.datasets[1].data = stats.dist.latencySamples;
                latencyChart.update('none');
            }

            if (collisionChart) {
                collisionChart.data.labels = labels;
                collisionChart.data.datasets[0].data = stats.mono.collisionSamples;
                collisionChart.data.datasets[1].data = stats.dist.collisionSamples;
                collisionChart.update('none');
            }
        } catch (e) {
            console.error("Chart update failed: ", e);
        }
    }

    // --- 12. Event Listeners ---
    const mmBtn = document.getElementById('mode-mono');
    const mdBtn = document.getElementById('mode-dist');
    const startBtn = document.getElementById('btn-start');
    const pauseBtn = document.getElementById('btn-pause');
    const resetBtn = document.getElementById('btn-reset');
    const speedRange = document.getElementById('speed-range');
    const spawnRange = document.getElementById('spawn-rate');
    const clearBtn = document.getElementById('btn-clear-log');

    if (mmBtn) mmBtn.addEventListener('click', () => switchMode('mono'));
    if (mdBtn) mdBtn.addEventListener('click', () => switchMode('dist'));
    if (startBtn) startBtn.addEventListener('click', startSimulator);
    if (pauseBtn) pauseBtn.addEventListener('click', pauseSimulator);
    if (resetBtn) resetBtn.addEventListener('click', resetSimulator);

    if (speedRange) {
        speedRange.addEventListener('input', (e) => {
            simulationSpeed = parseInt(e.target.value);
            addLog(`[System] 시뮬레이션 배속이 ${simulationSpeed}x로 변경되었습니다.`);
        });
    }

    if (spawnRange) {
        spawnRange.addEventListener('input', (e) => {
            orderSpawnRate = parseInt(e.target.value);
            addLog(`[System] 주문 생성 속도가 ${orderSpawnRate}/10 단계로 변경되었습니다.`);
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            const consoleBox = document.getElementById('log-output');
            if (consoleBox) consoleBox.innerHTML = '';
        });
    }

    window.addEventListener('resize', () => {
        drawWarehouse();
    });

    // --- Startup ---
    initRobots();
    initCharts();
    drawWarehouse();
    updateDashboardMetrics();
});
