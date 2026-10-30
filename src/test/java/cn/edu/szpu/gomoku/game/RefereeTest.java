package cn.edu.szpu.gomoku.game;

import cn.edu.szpu.gomoku.dto.SubmitResultReq;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * 裁判重放校验（K3）：对局上报防伪造的唯一防线，必须全覆盖。
 */
class RefereeTest {

    private static SubmitResultReq.Move mv(int r, int c, int color) {
        return new SubmitResultReq.Move(r, c, color);
    }

    /** 黑横向五连 → 判 1（最后一手成五立即返回） */
    @Test
    void blackHorizontalFiveWins() {
        List<SubmitResultReq.Move> moves = new ArrayList<>();
        // 黑 (7,3..7,7) 五连；白在别处应招
        int[][] black = {{7, 3}, {7, 4}, {7, 5}, {7, 6}, {7, 7}};
        int[][] white = {{8, 3}, {8, 4}, {8, 5}, {8, 6}};
        for (int i = 0; i < 4; i++) {
            moves.add(mv(black[i][0], black[i][1], 1));
            moves.add(mv(white[i][0], white[i][1], 2));
        }
        moves.add(mv(7, 7, 1));
        assertEquals(1, Referee.judge(moves));
    }

    /** 白斜向五连 → 判 2 */
    @Test
    void whiteDiagonalFiveWins() {
        List<SubmitResultReq.Move> moves = new ArrayList<>();
        int[][] black = {{0, 0}, {1, 0}, {2, 0}, {3, 0}, {0, 1}};
        int[][] white = {{3, 3}, {4, 4}, {5, 5}, {6, 6}, {7, 7}};
        for (int i = 0; i < 4; i++) {
            moves.add(mv(black[i][0], black[i][1], 1));
            moves.add(mv(white[i][0], white[i][1], 2));
        }
        moves.add(mv(black[4][0], black[4][1], 1));
        moves.add(mv(white[4][0], white[4][1], 2));
        assertEquals(2, Referee.judge(moves));
    }

    /** 未成五 → -1 进行中 */
    @Test
    void noFiveIsOngoing() {
        List<SubmitResultReq.Move> moves = new ArrayList<>();
        moves.add(mv(7, 7, 1));
        moves.add(mv(8, 8, 2));
        assertEquals(-1, Referee.judge(moves));
    }

    /** 空序列 → -1（不是平局：一盘没下） */
    @Test
    void emptyMovesIsOngoing() {
        assertEquals(-1, Referee.judge(new ArrayList<>()));
    }

    /** 黑白交替被破坏 → -2 非法 */
    @Test
    void wrongTurnOrderRejected() {
        List<SubmitResultReq.Move> moves = new ArrayList<>();
        moves.add(mv(7, 7, 1));
        moves.add(mv(8, 8, 1)); // 该白下了
        assertEquals(-2, Referee.judge(moves));
    }

    /** 白先手 → -2（黑永远先行） */
    @Test
    void whiteFirstRejected() {
        List<SubmitResultReq.Move> moves = new ArrayList<>();
        moves.add(mv(7, 7, 2));
        assertEquals(-2, Referee.judge(moves));
    }

    /** 同格重复落子 → -2 */
    @Test
    void duplicateCellRejected() {
        List<SubmitResultReq.Move> moves = new ArrayList<>();
        moves.add(mv(7, 7, 1));
        moves.add(mv(7, 7, 2));
        assertEquals(-2, Referee.judge(moves));
    }

    /** 越界坐标 → -2 */
    @Test
    void outOfBoundsRejected() {
        List<SubmitResultReq.Move> moves = new ArrayList<>();
        moves.add(mv(-1, 7, 1));
        assertEquals(-2, Referee.judge(moves));
        List<SubmitResultReq.Move> moves2 = new ArrayList<>();
        moves2.add(mv(15, 0, 1));
        assertEquals(-2, Referee.judge(moves2));
    }

    /** color 非法值（null/3）→ -2 */
    @Test
    void illegalColorRejected() {
        List<SubmitResultReq.Move> moves = new ArrayList<>();
        moves.add(new SubmitResultReq.Move(7, 7, null));
        assertEquals(-2, Referee.judge(moves));
    }

    /** 下满 225 手无五连 → 0 平局。
     *  棋纹 pattern[(r + 2c) % 4]（XXoo 斜条带 +2 行错位）：
     *  黑 113 / 白 112 恰好交替落满，任何直线方向同色最多连 2。 */
    @Test
    void fullBoardWithoutFiveIsDraw() {
        int[] pat = {1, 1, 2, 2};
        List<SubmitResultReq.Move> moves = new ArrayList<>();
        List<int[]> blacks = new ArrayList<>();
        List<int[]> whites = new ArrayList<>();
        for (int r = 0; r < 15; r++) {
            for (int c = 0; c < 15; c++) {
                int color = pat[Math.floorMod(r + 2 * c, 4)];
                (color == 1 ? blacks : whites).add(new int[]{r, c});
            }
        }
        assertEquals(113, blacks.size());
        assertEquals(112, whites.size());
        int bi = 0, wi = 0;
        while (bi < blacks.size() || wi < whites.size()) {
            if (bi < blacks.size()) moves.add(mv(blacks.get(bi)[0], blacks.get(bi)[1], 1));
            bi++;
            if (wi < whites.size()) moves.add(mv(whites.get(wi)[0], whites.get(wi)[1], 2));
            wi++;
        }
        assertEquals(225, moves.size());
        assertEquals(0, Referee.judge(moves));
    }
}
