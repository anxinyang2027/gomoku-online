package cn.edu.szpu.gomoku.game;

public final class Referee {

    private Referee() {
    }

    public static final int SIZE = 15;

    // Legal Play Judge returns the winning color, 0 = full board draw, -1 = game not over
    public static int judge(java.util.List<cn.edu.szpu.gomoku.dto.SubmitResultReq.Move> moves) {
        int[][] grid = new int[SIZE][SIZE];
        int expected = 1;
        for (cn.edu.szpu.gomoku.dto.SubmitResultReq.Move m : moves) {
            if (m.r() < 0 || m.r() >= SIZE || m.c() < 0 || m.c() >= SIZE) return -2;
            if (grid[m.r()][m.c()] != 0) return -2;
            if (m.color() == null || m.color() != expected) return -2;
            grid[m.r()][m.c()] = m.color();
            if (countFive(grid, m.r(), m.c(), m.color())) return m.color();
            expected = 3 - expected;
        }
        return moves.size() == SIZE * SIZE ? 0 : -1;
    }

    private static boolean countFive(int[][] grid, int r, int c, int color) {
        final int[][] dirs = {{0, 1}, {1, 0}, {1, 1}, {1, -1}};
        for (int[] d : dirs) {
            int n = 1;
            for (int i = 1; i < 5; i++) {
                int rr = r - d[0] * i, cc = c - d[1] * i;
                if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || grid[rr][cc] != color) break;
                n++;
            }
            for (int i = 1; i < 5; i++) {
                int rr = r + d[0] * i, cc = c + d[1] * i;
                if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || grid[rr][cc] != color) break;
                n++;
            }
            if (n >= 5) return true;
        }
        return false;
    }
}
