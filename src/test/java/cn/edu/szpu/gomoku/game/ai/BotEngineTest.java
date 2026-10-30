package cn.edu.szpu.gomoku.game.ai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BotEngineTest {

    private static int[][] blank() {
        return new int[BotEngine.SIZE][BotEngine.SIZE];
    }

    private static void put(int[][] g, int r, int c, int color) {
        g[r][c] = color;
    }

    @Test
    void emptyBoardReturnsCenter() {
        int[][] g = blank();
        for (int level = 1; level <= 3; level++) {
            int[] mv = BotEngine.chooseMove(g, 2, level);
            assertNotNull(mv);
            assertEquals(7, mv[0]);
            assertEquals(7, mv[1]);
        }
    }

    @Test
    void blocksOpponentFour() {
        int[][] g = blank();
        put(g, 7, 3, 1);
        put(g, 7, 4, 1);
        put(g, 7, 5, 1);
        put(g, 7, 6, 1);
        for (int level = 1; level <= 3; level++) {
            int[] mv = BotEngine.chooseMove(g, 2, level);
            assertNotNull(mv);
            boolean endOne = mv[0] == 7 && (mv[1] == 2 || mv[1] == 7);
            assertEquals(true, endOne, "level " + level + " chose (" + mv[0] + "," + mv[1] + ")");
        }
    }

    @Test
    void completesOwnFive() {
        int[][] g = blank();
        put(g, 9, 3, 2);
        put(g, 9, 4, 2);
        put(g, 9, 5, 2);
        put(g, 9, 6, 2);
        for (int level = 1; level <= 3; level++) {
            int[] mv = BotEngine.chooseMove(g, 2, level);
            assertNotNull(mv);
            boolean ok = mv[0] == 9 && (mv[1] == 2 || mv[1] == 7);
            assertTrue(ok, "level " + level + " chose (" + mv[0] + "," + mv[1] + ")");
        }
    }

    @Test
    void neverChoosesOccupiedCell() {
        int[][] g = blank();
        for (int i = 0; i < 40; i++) {
            int r = (i * 3) % 15;
            int c = (i * 5) % 15;
            g[r][c] = (i % 2) + 1;
        }
        for (int level = 1; level <= 3; level++) {
            int[] mv = BotEngine.chooseMove(g, 1, level);
            assertNotNull(mv);
            assertEquals(0, g[mv[0]][mv[1]]);
        }
    }

    @Test
    void fullBoardReturnsNull() {
        int[][] g = new int[BotEngine.SIZE][BotEngine.SIZE];
        int c = 0;
        for (int r = 0; r < BotEngine.SIZE; r++)
            for (int k = 0; k < BotEngine.SIZE; k++) g[r][k] = (c++ % 2) + 1;
        assertNull(BotEngine.chooseMove(g, 2, 1));
    }

    @Test
    void isFiveDetectsWinHorizontal() {
        int[][] g = blank();
        for (int c = 4; c <= 8; c++) put(g, 7, c, 1);
        assertTrue(BotEngine.isFive(g, 7, 6, 1));
        assertTrue(!BotEngine.isFive(g, 7, 4, 2));
    }

    @Test
    void hardSearchUnderTimeBudget() {
        int[][] mid = blank();
        int[] stones = {
                7, 7, 1, 7, 8, 2, 8, 8, 1, 8, 7, 1, 6, 7, 2, 9, 7, 1, 9, 8, 2,
                6, 8, 1, 5, 7, 2, 10, 8, 1, 10, 7, 2, 4, 8, 1,
        };
        for (int i = 0; i < stones.length; i += 3) {
            put(mid, stones[i], stones[i + 1], stones[i + 2]);
        }
        long t0 = System.currentTimeMillis();
        int[] mv = BotEngine.chooseMove(mid, 1, 3);
        long ms = System.currentTimeMillis() - t0;
        assertNotNull(mv);
        assertTrue(ms < 4000, "hard bot took " + ms + "ms");
    }
}
