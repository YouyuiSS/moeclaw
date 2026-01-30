import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as PIXI from 'pixi.js';
// Static import removed
// import { Live2DModel } from 'pixi-live2d-display';

// Expose PIXI to window for pixi-live2d-display to find it
window.PIXI = PIXI;

const Live2DViewer = forwardRef(({ modelPath, talkingVolume }, ref) => {
    const canvasRef = useRef(null);
    const appRef = useRef(null);
    const modelRef = useRef(null);

    useImperativeHandle(ref, () => ({
        motion: (group, index) => {
            if (modelRef.current) {
                modelRef.current.motion(group, index);
            }
        }
    }));

    useEffect(() => {
        if (!canvasRef.current) return;

        let mounted = true;

        (async () => {
            try {
                // Dynamic import to ensure window.PIXI is set before library loads
                const { Live2DModel } = await import('pixi-live2d-display');

                if (!mounted) return;

                // Initialize PIXI Application
                appRef.current = new PIXI.Application({
                    view: canvasRef.current,
                    autoStart: true,
                    backgroundAlpha: 0,
                    resizeTo: window,
                });

                const model = await Live2DModel.from(modelPath);
                modelRef.current = model;

                model.anchor.set(0.5, 0.5);
                model.position.set(window.innerWidth / 2, window.innerHeight * 0.8);

                const scale = Math.min(window.innerWidth / model.width, window.innerHeight / model.height) * 0.8;
                model.scale.set(scale);

                model.on('hit', (hitAreas) => {
                    if (hitAreas.includes('body')) {
                        model.motion('TapBody');
                    }
                    if (hitAreas.includes('head')) {
                        model.expression('Surprise');
                    }
                });

                if (appRef.current && appRef.current.stage) {
                    appRef.current.stage.addChild(model);
                    console.log("Model loaded successfully");

                    // Override the model's update method to ensure our lip sync value isn't overwritten
                    // This is robust against internal model updates resetting the parameter
                    const originalUpdate = model.update;
                    model.update = function (delta) {
                        originalUpdate.call(this, delta);

                        const vol = volumeRef.current;
                        // Debug logging
                        if (Math.random() < 0.05 && vol > 0.001) {
                            console.log("Live2D Volume:", vol, "Target Value:", Math.min(1.0, vol * 8.0));
                        }

                        if (this.internalModel?.coreModel) {
                            // Sensitivity boosted: vol * 8
                            const value = Math.min(1.0, vol > 0.01 ? vol * 8.0 : 0);

                            // Force set the parameter after the model's internal update
                            this.internalModel.coreModel.setParameterValueById(
                                'ParamMouthOpenY',
                                value
                            );
                        }
                    };
                }
            } catch (e) {
                console.error("Failed to load Live2D model or library:", e);
            }
        })();

        const handleResize = () => {
            if (appRef.current && modelRef.current) {
                appRef.current.resize();
                modelRef.current.position.set(window.innerWidth / 2, window.innerHeight * 0.8);
            }
        };
        window.addEventListener('resize', handleResize);

        return () => {
            mounted = false;
            window.removeEventListener('resize', handleResize);
            if (appRef.current) {
                appRef.current.destroy(true, { children: true });
                appRef.current = null;
            }
        };
    }, [modelPath]);

    // Sync Lip Sync with Volume via Ref to avoid re-binding
    const volumeRef = useRef(0);
    useEffect(() => {
        volumeRef.current = talkingVolume;
    }, [talkingVolume]);


    return (
        <canvas
            ref={canvasRef}
            style={{ position: 'absolute', top: 0, left: 0, zIndex: 0 }}
        />
    );
});

Live2DViewer.displayName = 'Live2DViewer';

export default Live2DViewer;
