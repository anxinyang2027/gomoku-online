package cn.edu.szpu.gomoku.mapper;

import cn.edu.szpu.gomoku.entity.UserItem;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

public interface UserItemMapper extends BaseMapper<UserItem> {

    @Update("UPDATE user_item ui JOIN shop_item si ON si.id = ui.item_id " +
            "SET ui.in_use = 0 WHERE ui.user_id = #{userId} AND si.cat = #{cat}")
    int clearInUseForCat(@Param("userId") Long userId, @Param("cat") String cat);

    /** 复合主键(user_id,item_id)置在用——实体无 @TableId，BaseMapper 的
     *  updateById 不会被注入（调用即 BindingException），故走显式条件更新 */
    @Update("UPDATE user_item SET in_use = 1 " +
            "WHERE user_id = #{userId} AND item_id = #{itemId}")
    int markInUse(@Param("userId") Long userId, @Param("itemId") String itemId);
}
