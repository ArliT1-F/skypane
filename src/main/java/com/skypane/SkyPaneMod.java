package com.skypane;

import com.skypane.block.SkyPaneBlock;
import net.fabricmc.api.ModInitializer;
import net.minecraft.core.Registry;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.block.Block;

public class SkyPaneMod implements ModInitializer {

    public static final Block SKY_PANE = new SkyPaneBlock();

    @Override
    public void onInitialize() {
        Registry.register(
                net.minecraft.core.registries.BuiltInRegistries.BLOCK,
                new ResourceLocation("skypane", "sky_pane"),
                SKY_PANE
        );
    }
}