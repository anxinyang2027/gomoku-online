package cn.edu.szpu.gomoku.game.ai;

import java.util.ArrayList;
import java.util.List;

/**
 * 服务器五子棋引擎:三档难度(1 入门 / 2 进阶 / 3 高手)。
 * 复用自由规则(无禁手),与 Referee 同一套 15×15 坐标系。
 */
public final class BotEngine {

    private BotEngine() {
    }

    public static final int SIZE = 15;
    private static final int WIN = 1_000_000_000;
    private static final long TIME_LIMIT_MS = 1700;

    /** 窗口评分表:窗口内己方 k 子且无对方子 -> W[k] */
    private static final long[] W = {0, 4, 40, 400, 9000, 1_500_000};

    private static final int[][] DIRS = {{0, 1}, {1, 0}, {1, 1}, {1, -1}};

    /**
     * 在 grid 上为 color 选一步棋。
     * @param grid 15×15,0 空 1 黑 2 白
     * @return {r, c};棋盘无空位时返回 null
     */
    public static int[] chooseMove(int[][] grid, int color, int difficulty) {
        List<int[]> cands = candidates(grid);
        if (cands.isEmpty()) return null;

        int d = switch (difficulty) {
            case 3 -> 3;
            case 2 -> 2;
            default -> 1;
        };

        // 立即取胜点(idempotent,双方视角各查一遍)
        List<int[]> selfWins = winCells(grid, color, cands);
        if (!selfWins.isEmpty()) return norm(selfWins.get(0));

        // 对方一步成五点 -> 强制封锁
        List<int[]> oppWins = winCells(grid, 3 - color, cands);
        if (!oppWins.isEmpty()) {
            List<int[]> forced = new ArrayList<>();
            for (int[] p : cands) if (contains(oppWins, p)) forced.add(p);
            if (d == 1) return bestByHeuristic(grid, color, forced);
            return searchRoot(grid, color, forced, d == 2 ? 2 : 4, bwBeam(d, forced));
        }

        if (d == 1) return bestByHeuristic(grid, color, cands);
        int beam = bwBeam(d, cands);
        return searchRoot(grid, color, cands, d == 2 ? 2 : 4, beam);
    }

    /** 棋盘逐空位的 ±2 邻域候选;空盘返回天元 */
    static List<int[]> candidates(int[][] grid) {
        boolean any = false;
        for (int r = 0; r < SIZE && !any; r++)
            for (int c = 0; c < SIZE && !any; c++) any = grid[r][c] != 0;
        List<int[]> list = new ArrayList<>();
        if (!any) {
            list.add(new int[]{7, 7});
            return list;
        }
        for (int r = 0; r < SIZE; r++) {
            for (int c = 0; c < SIZE; c++) {
                if (grid[r][c] != 0) continue;
                if (nearStone(grid, r, c)) list.add(new int[]{r, c});
            }
        }
        return list;
    }

    private static boolean nearStone(int[][] grid, int r, int c) {
        for (int dr = -2; dr <= 2; dr++) {
            for (int dc = -2; dc <= 2; dc++) {
                int rr = r + dr, cc = c + dc;
                if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && grid[rr][cc] != 0) return true;
            }
        }
        return false;
    }

    /** 某方所有"落子即胜"的空位 */
    static List<int[]> winCells(int[][] grid, int color, List<int[]> cands) {
        List<int[]> wins = new ArrayList<>();
        for (int[] p : cands) {
            grid[p[0]][p[1]] = color;
            boolean f = five(grid, p[0], p[1], color);
            grid[p[0]][p[1]] = 0;
            if (f) wins.add(p);
        }
        return wins;
    }

    /** 终局判定:该点形成的己方在四向是否已有五连 */
    public static boolean isFive(int[][] grid, int r, int c, int color) {
        return five(grid, r, c, color);
    }

    private static boolean five(int[][] grid, int r, int c, int color) {
        for (int[] d : DIRS) {
            int n = 1;
            for (int s : new int[]{1, -1}) {
                int rr = r + d[0] * s, cc = c + d[1] * s;
                while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && grid[rr][cc] == color) {
                    n++;
                    rr += d[0] * s;
                    cc += d[1] * s;
                }
            }
            if (n >= 5) return true;
        }
        return false;
    }

    /** 活三/冲四评分:落子后经过该点 4 个方向的连子 + 开端数 */
    static long heuristic(int[][] grid, int r, int c, int color) {
        long attack = pointScore(grid, r, c, color);
        long defense = pointScore(grid, r, c, 3 - color);
        return attack + defense * (attack >= 100 ? 6 : 10) / 10;
    }

    /** 假想落子的棋型分(五 1e6 / 活四 1e5 / 冲四 1e4 / 活三 5e3 …) */
    static long pointScore(int[][] grid, int r, int c, int color) {
        grid[r][c] = color;
        long s = 0;
        for (int[] d : DIRS) {
            int n = 1;
            boolean blockA = false, blockB = false;
            for (int sgn : new int[]{1, -1}) {
                int rr = r + d[0] * sgn, cc = c + d[1] * sgn;
                while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && grid[rr][cc] == color) {
                    n++;
                    rr += d[0] * sgn;
                    cc += d[1] * sgn;
                }
                boolean blocked = rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE
                        || grid[rr][cc] == 3 - color;
                if (sgn == 1) blockA = blocked;
                else blockB = blocked;
            }
            int open = (blockA ? 0 : 1) + (blockB ? 0 : 1);
            s += shape(n, open);
        }
        grid[r][c] = 0;
        return s;
    }

    private static long shape(int n, int open) {
        if (n >= 5) return 1_000_000;
        if (n == 4) return open >= 2 ? 120_000 : (open >= 1 ? 12_000 : 0);
        if (n == 3) return open >= 2 ? 7_000 : (open >= 1 ? 700 : 0);
        if (n == 2) return open >= 2 ? 260 : (open >= 1 ? 35 : 0);
        return open >= 2 ? 22 : 3;
    }

    private static int[] bestByHeuristic(int[][] grid, int color, List<int[]> cands) {
        int[] best = null;
        long bestVal = Long.MIN_VALUE;
        for (int[] p : cands) {
            long v = heuristic(grid, p[0], p[1], color) * 1_000L - p[0] * SIZE - p[1];
            if (v > bestVal) {
                bestVal = v;
                best = p;
            }
        }
        return best == null ? null : norm(best);
    }

    private static int bwBeam(int difficulty, List<int[]> cands) {
        return difficulty == 2 ? Math.min(cands.size(), 12) : Math.min(cands.size(), 8);
    }

    private static int[] searchRoot(int[][] grid, int color, List<int[]> cands, int depth, int beam) {
        long deadline = System.currentTimeMillis() + TIME_LIMIT_MS;
        List<int[]> ordered = beamOrder(grid, color, cands, beam);
        int[] best = ordered.get(0);
        long alpha = Long.MIN_VALUE, beta = Long.MAX_VALUE;
        for (int[] p : ordered) {
            grid[p[0]][p[1]] = color;
            long val;
            if (five(grid, p[0], p[1], color)) {
                val = WIN;
            } else {
                val = -negamax(grid, 3 - color, depth - 1, -beta, -alpha, deadline);
            }
            grid[p[0]][p[1]] = 0;
            if (val > alpha) {
                alpha = val;
                best = p;
            }
        }
        return norm(best);
    }

    private static long negamax(int[][] grid, int color, int depth, long alpha, long beta, long deadline) {
        if (System.currentTimeMillis() > deadline) return eval(grid, color);
        if (depth <= 0) return eval(grid, color);
        List<int[]> cands = candidates(grid);
        if (cands.isEmpty()) return 0;
        // 死路盘面:任何一手后对手若必胜则窗口顶住;这里靠 beamOrder 按威胁排序近似
        List<int[]> ordered = beamOrder(grid, color, cands, Math.min(cands.size(), 12));
        for (int[] p : ordered) {
            grid[p[0]][p[1]] = color;
            long val;
            if (five(grid, p[0], p[1], color)) {
                val = WIN - 1;
            } else if (depth == 1) {
                val = eval(grid, color);
            } else {
                val = -negamax(grid, 3 - color, depth - 1, -beta, -alpha, deadline);
            }
            grid[p[0]][p[1]] = 0;
            if (val > alpha) alpha = val;
            if (alpha >= beta) break;
        }
        return alpha;
    }

    /** 按启发分排序取前 beam 个;候选点自身成五/挡五排最前 */
    private static List<int[]> beamOrder(int[][] grid, int color, List<int[]> cands, int beam) {
        List<long[]> scored = new ArrayList<>();
        for (int[] p : cands) {
            grid[p[0]][p[1]] = color;
            long selfWin = five(grid, p[0], p[1], color) ? 1 : 0;
            grid[p[0]][p[1]] = 0;
            long s = heuristic(grid, p[0], p[1], color);
            scored.add(new long[]{selfWin * 4_000_000_000L + s, p[0], p[1]});
        }
        scored.sort((a, b) -> {
            if (a[0] != b[0]) return Long.compare(b[0], a[0]);
            return Long.compare(a[1] * SIZE + a[2], b[1] * SIZE + b[2]);
        });
        List<int[]> out = new ArrayList<>();
        for (int i = 0; i < Math.min(beam, scored.size()); i++) {
            out.add(new int[]{(int) scored.get(i)[1], (int) scored.get(i)[2]});
        }
        return out;
    }

    /** 窗口求和估值:双方各扫 88 条线的所有 5 连窗口 */
    static long eval(int[][] grid, int color) {
        long mine = windows(grid, color);
        long theirs = windows(grid, 3 - color);
        return mine - theirs * 11 / 10;
    }

    private static long windows(int[][] grid, int color) {
        long total = 0;
        for (int r = 0; r < SIZE; r++) total += lineScore(grid, r, 0, 0, 1, color);
        for (int c = 0; c < SIZE; c++) total += lineScore(grid, 0, c, 1, 0, color);
        total += diagScore(grid, color);
        return total;
    }

    private static long lineScore(int[][] grid, int sr, int sc, int dr, int dc, int color) {
        int len = Math.min(
                dr == 1 ? SIZE - sr : SIZE,
                dc == 1 ? SIZE - sc : SIZE
        );
        return slide(grid, sr, sc, dr, dc, len, color);
    }

    private static long diagScore(int[][] grid, int color) {
        long t = 0;
        for (int k = -(SIZE - 1); k <= SIZE - 1; k++) {
            int len = SIZE - Math.abs(k);
            if (len < 5) continue;
            t += slide(grid, k < 0 ? -k : 0, k > 0 ? k : 0, 1, 1, len, color);
        }
        for (int k = 0; k <= 2 * (SIZE - 1); k++) {
            int len = k < SIZE ? k + 1 : 2 * (SIZE - 1) - k + 1;
            if (len < 5) continue;
            t += slide(grid, k < SIZE ? 0 : k - (SIZE - 1), k < SIZE ? k : SIZE - 1, 1, -1, len, color);
        }
        return t;
    }

    private static long slide(int[][] grid, int sr, int sc, int dr, int dc, int len, int color) {
        long s = 0;
        for (int start = 0; start + 5 <= len; start++) {
            int mine = 0, theirs = 0;
            for (int i = 0; i < 5; i++) {
                int v = grid[sr + dr * (start + i)][sc + dc * (start + i)];
                if (v == color) mine++;
                else if (v != 0) theirs++;
            }
            if (mine > 0 && theirs > 0) continue;
            if (mine > 0) s += W[mine];
        }
        return s;
    }

    private static int[] norm(int[] p) {
        return new int[]{p[0], p[1]};
    }

    private static boolean contains(List<int[]> list, int[] p) {
        for (int[] q : list) if (q[0] == p[0] && q[1] == p[1]) return true;
        return false;
    }
}
